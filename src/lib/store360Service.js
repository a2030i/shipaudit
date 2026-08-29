import { supabase } from './supabase.js';
import { loadLatestMerchants } from './merchantsService.js';
import { loadCustomerMoneyDashboard, loadZohoOpenInvoices } from './pnlService.js';
import { buildCampaignAgingProjection, lineMatchesAging } from './agingOperations.js';
import { listTasks } from './collectionsService.js';
import { loadPlatformSalesAccount } from './retargetingService.js';
import { listInteractions } from './customerInteractionsService.js';
import { normalizeStoreTimeline } from './store360Timeline.js';
import { loadCustomerFinancialPosition } from './customerFinancialPosition.js';
import {
  loadStore360CoreRpc, scheduleStore360CoreShadow, STORE_360_CORE_READ_MODE,
} from './store360Shadow.js';

const normalizePhone = (raw) => {
  let value = String(raw || '').replace(/\D/g, '');
  if (value.startsWith('00966')) value = value.slice(5);
  else if (value.startsWith('966')) value = value.slice(3);
  if (value.startsWith('0')) value = value.slice(1);
  return value;
};

const exactText = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const source = (status, label, updatedAt = null, error = null) => ({ status, label, updatedAt, error });

async function attachFinancialPosition(core) {
  const finance = core?.financial;
  if (!finance?.zohoId) return core;
  const position = await loadCustomerFinancialPosition(finance.zohoId);
  if (!position) return core;
  return {
    ...core,
    financial: {
      ...finance,
      accountingOutstanding: position.accountingOutstanding,
      operationalCollectible: position.operationalCollectible,
      residualBalance: position.residualBalance,
      creditOffset: position.creditOffset,
      financialPositionReconciled: position.sourceReconciledExactly && position.reconciledExactly,
      balanceSyncIssue: finance.balanceSyncIssue || !(position.sourceReconciledExactly && position.reconciledExactly),
      outstanding: position.operationalCollectible,
    },
  };
}

function merchantView(row) {
  if (!row) return null;
  return {
    storeId: row.store_id || row.storeId || '', storeName: row.store_name || row.storeName || '',
    phone: row.phone || '', shipmentCount: Number(row.shipment_count ?? row.shipmentCount) || 0,
    lastShipmentAt: row.last_shipment_at || row.lastShipmentAt || null,
    integrationType: row.integration_type || row.integrationType || '',
    billingType: row.billing_type || row.billingType || '', status: row.status || row.platformStatus || '',
    walletBalance: Number(row.wallet_balance ?? row.walletBalance) || 0,
    createdAt: row.created_at_platform || row.createdAtPlatform || null,
    lastTopupAt: row.last_topup_at || row.lastTopupAt || null,
  };
}

function resolveMerchant(identity, merchants, moneyRows) {
  const raw = String(identity || '').trim();
  const phone = normalizePhone(raw);
  const moneyDirect = moneyRows.find(row => exactText(row.storeId, raw) || exactText(row.name, raw) || exactText(row.storeName, raw));
  const exact = merchants.find(row => exactText(row.store_id, raw))
    || (moneyDirect?.storeId ? merchants.find(row => exactText(row.store_id, moneyDirect.storeId)) : null)
    || merchants.find(row => exactText(row.store_name, raw));
  if (exact) return exact;
  if (phone.length >= 8) return merchants.find(row => normalizePhone(row.phone) === phone) || null;
  return null;
}

async function loadStore360CoreLegacy(identity, { shadow = true } = {}) {
  const [merchantResult, moneyResult, syncResult] = await Promise.allSettled([
    loadLatestMerchants(),
    loadCustomerMoneyDashboard(),
    supabase.from('zoho_sync_state').select('entity, last_sync').in('entity', ['invoices', 'customerpayments']),
  ]);
  const merchants = merchantResult.status === 'fulfilled' ? merchantResult.value?.merchants || [] : [];
  const moneyRows = moneyResult.status === 'fulfilled' ? moneyResult.value?.customers || [] : [];
  const merchantRaw = resolveMerchant(identity, merchants, moneyRows);
  const merchant = merchantView(merchantRaw);
  const directMoney = moneyRows.find(row => exactText(row.storeId, merchant?.storeId))
    || (!merchant ? moneyRows.find(row => exactText(row.storeId, identity) || exactText(row.name, identity)) : null);
  const effectiveMerchant = merchant || merchantView(directMoney ? {
    store_id: directMoney.storeId, store_name: directMoney.storeName,
    phone: directMoney.phone, billing_type: directMoney.billingType,
    status: directMoney.platformStatus, wallet_balance: directMoney.walletBalance,
    last_shipment_at: directMoney.lastShipmentAt,
  } : null);
  if (!effectiveMerchant && !directMoney) {
    const err = new Error('لم نجد متجرًا يطابق الرابط الحالي');
    err.code = 'STORE_NOT_FOUND';
    throw err;
  }

  const samePhone = effectiveMerchant?.phone ? merchants
    .filter(row => normalizePhone(row.phone) && normalizePhone(row.phone) === normalizePhone(effectiveMerchant.phone))
    .map(merchantView) : [];
  const syncRows = syncResult.status === 'fulfilled' && !syncResult.value.error ? syncResult.value.data || [] : [];
  const invoiceSync = syncRows.find(row => row.entity === 'invoices')?.last_sync || null;
  const paymentSync = syncRows.find(row => row.entity === 'customerpayments')?.last_sync || null;

  const core = {
    store: effectiveMerchant,
    customerName: directMoney?.name || null,
    financial: directMoney ? {
      zohoId: directMoney.zohoId || null,
      accountingOutstanding: Number(directMoney.accountingOutstanding) || 0,
      operationalCollectible: Number(directMoney.operationalCollectible) || 0,
      residualBalance: Number(directMoney.residualBalance) || 0,
      creditOffset: Number(directMoney.creditOffset) || 0,
      financialPositionReconciled: directMoney.financialPositionReconciled !== false,
      outstanding: Number(directMoney.operationalCollectible) || 0, overdue: Number(directMoney.overdue) || 0,
      oldestDays: Number(directMoney.oldestDays) || 0,
      aging: { b0_15: directMoney.inv1_15, b16_30: directMoney.inv16_30, b31_60: directMoney.inv31_60, b61_90: directMoney.inv61_90, b90p: directMoney.inv90p, opening: directMoney.opening },
      lastPaymentDate: directMoney.lastPaymentDate || null,
      lastPaymentAmount: Number(directMoney.lastPaymentAmount) || 0,
      invoiceCount: Number(directMoney.invCnt) || 0,
      balanceSyncIssue: !!directMoney.balanceSyncIssue,
      balanceSyncGap: Number(directMoney.balanceSyncGap) || 0,
      balanceSyncOverage: Number(directMoney.balanceSyncOverage) || 0,
    } : null,
    sharedContactStores: samePhone.filter(row => row.storeId !== effectiveMerchant?.storeId),
    sources: {
      identity: merchantResult.status === 'fulfilled' && merchantResult.value?.snapshot
        ? source('available', 'دليل متاجر لمحة', merchantResult.value.snapshot.uploadedAt || merchantResult.value.snapshot.date)
        : source('unavailable', 'دليل متاجر لمحة', null, merchantResult.reason?.message || 'المصدر غير متاح'),
      finance: moneyResult.status === 'fulfilled'
        ? source(directMoney ? 'available' : 'empty', 'Zoho Books + محفظة لمحة', invoiceSync)
        : source('unavailable', 'Zoho Books + محفظة لمحة', null, moneyResult.reason?.message || 'المصدر غير متاح'),
      payments: moneyResult.status === 'fulfilled'
        ? source(directMoney ? 'available' : 'empty', 'دفعات Zoho Books', paymentSync)
        : source('unavailable', 'دفعات Zoho Books', null, moneyResult.reason?.message || 'المصدر غير متاح'),
    },
  };
  // Feature-gated shadow read. It is deliberately fire-and-forget: the visible
  // result, loading state and errors continue to come exclusively from the
  // established path until an explicit production cutover is approved.
  if (shadow) scheduleStore360CoreShadow({ storeId: effectiveMerchant?.storeId, oldCore: core });
  return core;
}

export async function loadStore360Core(identity) {
  const storeId = String(identity || '').trim();
  if (STORE_360_CORE_READ_MODE === 'core' && /^\d+$/.test(storeId)) {
    try {
      return await attachFinancialPosition(await loadStore360CoreRpc(storeId));
    } catch {
      return loadStore360CoreLegacy(identity, { shadow: false });
    }
  }
  return loadStore360CoreLegacy(identity);
}

export async function loadStore360Work({ phone, customerName }) {
  const [salesResult, tasksResult] = await Promise.allSettled([
    phone ? loadPlatformSalesAccount(phone) : Promise.resolve({ account: null, activities: [], lifecycle: [], statusChanges: [] }),
    customerName ? listTasks({ customer: customerName, includeDone: true }) : Promise.resolve([]),
  ]);
  const sales = salesResult.status === 'fulfilled' ? salesResult.value : null;
  const tasks = tasksResult.status === 'fulfilled' ? tasksResult.value || [] : [];
  const activeTask = tasks.find(task => ['todo', 'contacted', 'promised', 'snoozed'].includes(task.stage)) || null;
  const account = sales?.account || null;
  const candidates = [
    account?.next_action_at ? { at: account.next_action_at, label: account.next_action_type || 'متابعة مبيعات', source: 'المبيعات' } : null,
    activeTask?.promise_date ? { at: activeTask.promise_date, label: 'وعد تحصيل', source: 'التحصيل' } : null,
    activeTask?.snooze_until ? { at: activeTask.snooze_until, label: 'متابعة تحصيل', source: 'التحصيل' } : null,
  ].filter(Boolean).sort((a, b) => new Date(a.at) - new Date(b.at));
  return {
    sales, tasks, activeTask, nextAction: candidates[0] || null,
    owner: account?.owner_name || activeTask?.assignee_name || null,
    sources: {
      sales: salesResult.status === 'fulfilled'
        ? source('available', 'مسار مبيعات المنصة', account?.updated_at || sales?.activities?.[0]?.created_at || null)
        : source('unavailable', 'مسار مبيعات المنصة', null, salesResult.reason?.message),
      collections: tasksResult.status === 'fulfilled'
        ? source('available', 'قائمة التحصيل', tasks[0]?.updated_at || tasks[0]?.created_at || null)
        : source('unavailable', 'قائمة التحصيل', null, tasksResult.reason?.message),
    },
  };
}

export async function loadStore360Finance({ customerName, zohoId = null, agingBuckets = [] }) {
  if (!customerName) return { invoices: [], source: source('empty', 'Zoho Books', null, 'المتجر غير مرتبط بحساب مالي حالي') };
  try {
    const allDetails = await loadZohoOpenInvoices(customerName, { zohoId });
    const selectedBuckets = new Set(agingBuckets);
    const details = agingBuckets.length
      ? allDetails.filter(row => lineMatchesAging(row, selectedBuckets))
      : allDetails;
    const campaignAging = buildCampaignAgingProjection(allDetails).totals;
    const allInvoiceRows = allDetails.filter(row => row.line_kind === 'invoice');
    const allOpeningRows = allDetails.filter(row => row.line_kind === 'opening_balance');
    return {
      invoices: details.filter(row => row.line_kind === 'invoice'),
      openingRows: details.filter(row => row.line_kind === 'opening_balance'),
      invoiceCount: allInvoiceRows.length,
      openingCount: allOpeningRows.length,
      oldestInvoiceDays: allInvoiceRows.reduce((max, row) => Math.max(max, Number(row.age_days) || 0), 0),
      selectedAmount: +details.reduce((sum, row) => sum + (Number(row.balance) || 0), 0).toFixed(2),
      campaignAging,
      agingBuckets,
      source: source('available', 'سطور التحصيل من Zoho Books'),
    };
  } catch (error) {
    return { invoices: [], openingRows: [], source: source('unavailable', 'سطور التحصيل من Zoho Books', null, error.message) };
  }
}

export async function loadStore360Shipments({ storeName, page = 0, pageSize = 20 }) {
  if (!storeName) return { rows: [], count: 0, page, source: source('empty', 'شحنات لمحة') };
  const from = page * pageSize;
  const { data, error, count } = await supabase.from('lamha_shipments')
    .select('id, order_no, store_name, order_date, order_status, carrier_name, awb, pickup_at, delivered_at, shipping_cost, created_at', { count: 'exact' })
    .eq('store_name', storeName)
    .order('order_date', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) return { rows: [], count: 0, page, source: source('unavailable', 'شحنات لمحة', null, error.message) };
  return { rows: data || [], count: count || 0, page, source: source('available', 'آخر snapshot لشحنات لمحة', data?.[0]?.created_at || data?.[0]?.order_date || null) };
}

export async function loadStore360Communications({ phone }) {
  const commResult = await Promise.resolve(
    phone ? supabase.rpc('customer_comm_timeline', { p_phone: String(phone) }) : { data: [], error: null },
  ).catch(error => ({ data: [], error }));
  const commFailed = Boolean(commResult?.error);
  const communications = commFailed ? [] : commResult.data || [];
  return {
    communications,
    sources: {
      communications: commFailed
        ? source('unavailable', 'سجل التواصل المرتبط بالرقم', null, commResult.error?.message)
        : source('available', 'WhatsApp + Hatif + IVR المرتبط برقم التواصل', communications[0]?.occurred_at || null),
    },
  };
}

export async function loadStore360Timeline({ core }) {
  const store = core.store;
  const [workResult, financeResult, shipmentsResult, communicationsResult, interactionResult] = await Promise.allSettled([
    loadStore360Work({ phone: store.phone, customerName: core.customerName }),
    loadStore360Finance({ customerName: core.customerName, zohoId: core.financial?.zohoId }),
    loadStore360Shipments({ storeName: store.storeName, page: 0, pageSize: 50 }),
    loadStore360Communications({ phone: store.phone }),
    listInteractions({ customerName: core.customerName, storeId: store.storeId, limit: 100 }),
  ]);
  const work = workResult.status === 'fulfilled' ? workResult.value : {};
  const finance = financeResult.status === 'fulfilled' ? financeResult.value : {};
  const shipments = shipmentsResult.status === 'fulfilled' ? shipmentsResult.value : {};
  const communications = communicationsResult.status === 'fulfilled' ? communicationsResult.value : {};
  const interactions = interactionResult.status === 'fulfilled' ? interactionResult.value : [];
  const payment = core.financial?.lastPaymentDate ? [{ date: core.financial.lastPaymentDate, amount: core.financial.lastPaymentAmount, source: 'Zoho Books' }] : [];
  return {
    rows: normalizeStoreTimeline({
      sales: work.sales?.activities || [], collections: work.tasks || [], interactions,
      payments: payment, invoices: finance.invoices || [], shipments: shipments.rows || [],
      communications: communications.communications || [],
    }),
    sources: { ...work.sources, finance: finance.source, shipments: shipments.source, ...communications.sources,
      interactions: interactionResult.status === 'fulfilled' ? source('available', 'سجل المتابعة الداخلي') : source('unavailable', 'سجل المتابعة الداخلي', null, interactionResult.reason?.message) },
  };
}
