// Company overview service — wraps the four RPCs that power /overview:
//   monthly_financial_snapshot(p_period)       — headline numbers
//   ap_aging_by_carrier()                      — open AP per carrier × age
//   carrier_spend_concentration(p_period)      — top N carriers by spend
//   customer_debt_concentration(p_limit)       — top N customers by debt
//
// loadOverview({ period, prevPeriod }) does a single round-trip with
// all four queries fanned out in parallel + the previous-period
// snapshot for month-over-month deltas. Returns the shape the
// /overview page renders directly — no further client-side
// aggregation needed.

import { supabase } from './supabase.js';
import { carrierScore } from './carrierScore.js';
import { summarizeEffectiveBankBalance } from './bankBalanceService.js';
import { deriveAccountingCycleStages } from './accountingCycleService.js';
import { loadLatestMerchants, merchantSnapshotSourceState } from './merchantsService.js';
import {
  isLamhaAccountDisabled,
  isLamhaAccountEnabled,
  isLamhaLifecycleStopped,
} from './lamhaAccountState.js';
import { DEFAULT_SUSPENSION_MIN_OVERDUE } from './lamhaDecisionActions.js';

const runtimeEnv = import.meta.env || {};
// The production cutover is deliberately limited to the first-screen Lite
// projection. Setting the environment flag to `legacy` is the instant
// rollback; `core` keeps the former oversized projection available for
// shadow diagnostics only.
export const OVERVIEW_READ_MODE = runtimeEnv.VITE_OVERVIEW_READ_MODE || 'lite';

// A slow optional dashboard source must not hold the whole home page in its
// loading state forever. The underlying request may still finish later, but
// this read is marked unavailable after the deadline so the rest of the
// independently verified sources can render.
export const OVERVIEW_SOURCE_TIMEOUT_MS = 8_000;

export function withSourceTimeout(promise, timeoutMs = OVERVIEW_SOURCE_TIMEOUT_MS, label = 'مصدر البيانات') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`انتهت مهلة قراءة ${label}`)),
      Math.max(0, Number(timeoutMs) || 0),
    );
  });
  return Promise.race([Promise.resolve(promise), timeout])
    .finally(() => clearTimeout(timer));
}

// 'YYYY-MM' helpers
export const currentPeriod = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
export const prevPeriodOf = (period) => {
  const [y, m] = (period || currentPeriod()).split('-').map(Number);
  const prev = new Date(y, m - 2, 1);  // m is 1-based, subtract 2 then add 1
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
};

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args || {});
  if (error) throw error;
  return data || [];
}

// Home-page customer decisions combine Zoho's open-invoice truth with the
// newest platform snapshot. A fuzzy name match is intentionally forbidden:
// an uncertain match must be reviewed, never used to stop or activate a store.
const decisionNumber = (value) => Number(value) || 0;
const decisionKey = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[أإآ]/g, 'ا')
  .replace(/ة/g, 'ه')
  .replace(/[\s\-_|/\\.،,]+/g, '');
const billingKey = (value) => decisionKey(value);
const platformKey = (value) => decisionKey(value);
const isPostpaid = (value) => ['دفعلاحق', 'postpaid'].includes(billingKey(value));
const isPrepaid = (value) => ['دفعمسبق', 'prepaid'].includes(billingKey(value));
const isPlatformActive = isLamhaAccountEnabled;
const isPlatformInactive = isLamhaAccountDisabled;

// Merchant snapshots are raw database rows (snake_case), while
// customer_money_dashboard is mapped by pnlService to the React-facing
// camelCase contract. Keep the join bilingual so an explicit store link is
// never lost merely because the two read models use different field casing.
const decisionStoreId = (row) => row?.store_id ?? row?.storeId ?? '';
const decisionStoreName = (row) => row?.store_name ?? row?.storeName ?? '';
const decisionBillingType = (row) => row?.billing_type ?? row?.billingType ?? '';
const decisionPlatformStatus = (row) => row?.status ?? row?.platform_status ?? row?.platformStatus ?? '';
const decisionWalletBalance = (row) => row?.wallet_balance ?? row?.walletBalance ?? 0;

export function buildCustomerDecisions(customerMoney, merchantSnapshot) {
  const customers = Array.isArray(customerMoney?.customers) ? customerMoney.customers : [];
  const merchants = Array.isArray(merchantSnapshot?.merchants) ? merchantSnapshot.merchants : [];
  const merchantById = new Map(merchants.filter(m => decisionStoreId(m)).map(m => [String(decisionStoreId(m)), m]));
  const merchantByName = new Map();
  const moneyByStoreId = new Map(customers.filter(c => decisionStoreId(c)).map(c => [String(decisionStoreId(c)), c]));
  const moneyByName = new Map();
  for (const merchant of merchants) {
    const key = decisionKey(decisionStoreName(merchant));
    if (key) merchantByName.set(key, merchantByName.has(key) ? null : merchant);
  }
  for (const customer of customers) {
    const key = decisionKey(decisionStoreName(customer) || customer.name);
    if (key) moneyByName.set(key, moneyByName.has(key) ? null : customer);
  }
  const merchantFor = (customer) => (decisionStoreId(customer) && merchantById.get(String(decisionStoreId(customer))))
    || merchantByName.get(decisionKey(decisionStoreName(customer) || customer.name)) || null;
  const moneyFor = (merchant) => (decisionStoreId(merchant) && moneyByStoreId.get(String(decisionStoreId(merchant))))
    || moneyByName.get(decisionKey(decisionStoreName(merchant))) || null;
  const asDecision = (merchant, customer = null) => ({
    storeId: decisionStoreId(merchant) || decisionStoreId(customer),
    name: decisionStoreName(merchant) || decisionStoreName(customer) || customer?.name || 'عميل غير مسمى',
    customerName: customer?.name || decisionStoreName(merchant),
    billingType: decisionBillingType(merchant) || decisionBillingType(customer),
    platformStatus: decisionPlatformStatus(merchant) || decisionPlatformStatus(customer),
    debt: decisionNumber(customer?.owed),
    over30: customer ? decisionNumber(customer.b1) + decisionNumber(customer.b2) + decisionNumber(customer.b3) : 0,
    invoiceCount: decisionNumber(customer?.inv_cnt),
    walletBalance: decisionNumber(decisionWalletBalance(merchant) ?? decisionWalletBalance(customer)),
    hasFinancialRecord: !!customer,
  });
  const stopPostpaid = [], activatePostpaid = [], deductPrepaid = [];
  const keepStopped = [], negativePrepaid = [], unlinkedFinance = [];
  const processedMerchantIds = new Set();

  for (const customer of customers) {
    const merchant = merchantFor(customer);
    if (!merchant) {
      if (decisionNumber(customer.owed) > 0.5 || decisionNumber(customer.inv_cnt) > 0) unlinkedFinance.push(asDecision(null, customer));
      continue;
    }
    processedMerchantIds.add(String(decisionStoreId(merchant) || merchant.id || decisionStoreName(merchant)));
    const row = asDecision(merchant, customer);
    if (isPostpaid(row.billingType) && isPlatformActive(row.platformStatus) && row.over30 > 0.5 && row.invoiceCount > 0) stopPostpaid.push(row);
    if (isPostpaid(row.billingType) && isPlatformInactive(row.platformStatus) && row.over30 > 0.5) keepStopped.push(row);
    if (isPrepaid(row.billingType) && row.walletBalance > 0.5 && row.debt > 0.5 && row.invoiceCount > 0) deductPrepaid.push(row);
    if (isPrepaid(row.billingType) && row.walletBalance < -0.5) negativePrepaid.push(row);
  }
  for (const merchant of merchants) {
    const id = String(decisionStoreId(merchant) || merchant.id || decisionStoreName(merchant));
    if (processedMerchantIds.has(id)) continue;
    const money = moneyFor(merchant);
    if (isPostpaid(decisionBillingType(merchant)) && isPlatformInactive(decisionPlatformStatus(merchant)) && (!money || decisionNumber(money.b1) + decisionNumber(money.b2) + decisionNumber(money.b3) <= 0.5)) {
      activatePostpaid.push(asDecision(merchant, money || null));
    }
    if (isPrepaid(decisionBillingType(merchant)) && decisionNumber(decisionWalletBalance(merchant)) < -0.5) negativePrepaid.push(asDecision(merchant, money || null));
  }
  for (const customer of customers) {
    const merchant = merchantFor(customer);
    if (!merchant) continue;
    const row = asDecision(merchant, customer);
    if (isPostpaid(row.billingType) && isPlatformInactive(row.platformStatus) && row.over30 <= 0.5) activatePostpaid.push(row);
  }
  const uniqueRows = (rows) => Array.from(new Map(rows.map(row => [row.storeId || `${row.name}:${row.customerName}`, row])).values())
    .sort((a, b) => Math.max(b.over30, b.debt, b.walletBalance) - Math.max(a.over30, a.debt, a.walletBalance));
  return {
    snapshotAt: merchantSnapshot?.snapshot?.uploadedAt || null,
    stopPostpaid: uniqueRows(stopPostpaid), activatePostpaid: uniqueRows(activatePostpaid),
    deductPrepaid: uniqueRows(deductPrepaid), keepStopped: uniqueRows(keepStopped),
    negativePrepaid: uniqueRows(negativePrepaid), unlinkedFinance: uniqueRows(unlinkedFinance),
  };
}

export async function loadOverview({ period = null, topN = 5 } = {}) {
  const thisPeriod = period || currentPeriod();
  const prevPeriod = prevPeriodOf(thisPeriod);

  const { loadEffectiveBankBalance } = await import('./bankBalanceService.js');
  const { loadCarrierNetBalances } = await import('./codSettlementService.js');
  const { loadAccountingCycle } = await import('./accountingCycleService.js');
  // رصيد البنك = نقطة الحقيقة المشتركة `loadEffectiveBankBalance` (تجمع ختامي
  // آخر كشف **لكل بنك**). كان هنا استعلام مكرَّر بـ`.limit(1)` = آخر كشف واحد
  // عبر كل البنوك، فأظهر رصيد بنك واحد وأخفى الباقي (بلاغ المستخدم 2026-07-28:
  // ساي فاي 1,543.32 حجب الإنماء 231,794.88 لأن كشفه أحدث بيوم).
  const checkedAt = new Date().toISOString();
  const supabaseRpc = async (name) => {
    const { data, error } = await supabase.rpc(name);
    if (error) throw error;
    return data;
  };
  const tasks = [
    { key: 'monthly', label: 'أداء الشهر', run: () => rpc('monthly_financial_snapshot', { p_period: thisPeriod }) },
    { key: 'previousMonth', label: 'أداء الشهر السابق', run: () => rpc('monthly_financial_snapshot', { p_period: prevPeriod }) },
    { key: 'apAging', label: 'أعمار التزامات الناقلين', run: () => rpc('ap_aging_by_carrier', {}) },
    { key: 'carrierSpend', label: 'تركيز إنفاق الناقلين', run: () => rpc('carrier_spend_concentration', { p_period: thisPeriod }) },
    { key: 'customerDebt', label: 'تركيز مديونيات العملاء', run: () => rpc('customer_debt_concentration', { p_limit: topN }) },
    { key: 'carrierHealth', label: 'سلامة الناقلين', run: () => rpc('carrier_health_kpis', {}) },
    { key: 'workingCapital', label: 'دورة التحصيل والسداد', run: () => rpc('working_capital_now', {}) },
    { key: 'banks', label: 'أرصدة البنوك', run: () => loadEffectiveBankBalance() },
    { key: 'carrierCod', label: 'تحصيلات الناقلين', run: () => loadCarrierNetBalances() },
    // Company-wide uncollected COD — carriers that collected cash on our
    // behalf and haven't remitted it yet (net = SUM(out) − SUM(in) > 0).
    // Previously only visible per-carrier inside /money; surfaced here.
    { key: 'zohoInvoices', label: 'فواتير زوهو', run: () => supabaseRpc('zoho_invoice_dashboard') },
    { key: 'zatcaPending', label: 'الفواتير المعلقة في زاتكا', run: () => supabaseRpc('zatca_pending_today') },
    // مرجع دين العملاء = زوهو الحي (فحص وكلاء 2026-07-03: كانت الرئيسية
    // تعرض 314K من snapshot غير مفلتر مقابل 191K في /receivables و250K في
    // زوهو — ثلاثة أرقام لنفس السؤال). فشل الجلب صامت → fallback للـ snapshot.
    { key: 'customerMoney', label: 'مديونيات العملاء', run: () => supabaseRpc('customer_money_dashboard') },
    { key: 'merchants', label: 'حالة المتاجر في المنصة', run: () => loadLatestMerchants() },
    { key: 'lamhaBalance', label: 'كشف حساب لمحة', run: async () => {
      const { data, error } = await supabase
        .from('store_balance_snapshots')
        .select('id, file_name, row_count, total_balance, uploaded_at')
        .eq('source', 'internal')
        .order('uploaded_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    } },
    // جاهزية الإقفال لا تُستنتج من عدد المصادر العام. هذا هو نفس العرض
    // التشغيلي الذي يحمي زر الإقفال داخل دورة المحاسب، وبذلك تظل المراحل
    // الحرجة وأخطاء مصادرها هي المرجع دون إنشاء حساب موازٍ في الرئيسية.
    { key: 'accountingCycle', label: 'جاهزية إقفال دورة المحاسب', run: () => loadAccountingCycle(thisPeriod) },
    // Customer decisions combine merchant state with receivables. Keep the
    // Zoho mirror freshness explicit instead of treating a cached dashboard
    // as live truth after a failed or delayed sync.
    { key: 'zohoInvoiceSync', label: 'حداثة فواتير Zoho', run: async () => {
      const { data, error } = await supabase
        .from('zoho_sync_state')
        .select('last_sync, last_status, last_error')
        .eq('entity', 'invoices')
        .maybeSingle();
      if (error) throw error;
      return data || null;
    } },
    // Collection truth subtracts unused Zoho credit that already covers a
    // debit. The invoice dashboard intentionally exposes the gross debit, so
    // it must not feed the "effective available" amount.
    { key: 'zohoFinancial', label: 'الرقابة المالية في زوهو', run: () => supabaseRpc('zoho_financial_control_dashboard') },
    // قراءة خفيفة من المرآة المحلية فقط؛ لا تضرب Zoho API عند كل فتح للرئيسية.
    { key: 'teamReadiness', label: 'جاهزية التشغيل', run: () => supabaseRpc('team_operational_readiness_snapshot') },
    // لقطة إدارية واحدة تجمع جاهزية المحاسبة والمالية والمبيعات. فشلها
    // يبقى null حتى تعرض الواجهة «المصدر غير متاح» بدل جاهزية مضللة.
    { key: 'teamStaffing', label: 'تغطية صلاحيات الفريق', run: () => supabaseRpc('team_staffing_readiness_snapshot') },
    // تغطية الصلاحيات الفعلية تستبعد المدير: الهدف إثبات أن الفريق نفسه
    // يستطيع تشغيل المسار، لا أن حساب المالك يستطيع فتح كل شيء.
    { key: 'collectionWork', label: 'جاهزية أعمال التحصيل', run: () => supabaseRpc('collection_work_readiness_snapshot') },
    // تغطية مهام التحصيل تُقاس من العملاء الذين يجب متابعتهم، لا من عدد
    // المهام الموجودة فقط؛ وبذلك لا تختفي المديونيات التي لم تُنشأ لها مهمة.
  ];
  // A failing source is reported independently; it does not blank the page or
  // become a misleading zero.
  const settled = await Promise.allSettled(tasks.map(task => (
    withSourceTimeout(Promise.resolve().then(task.run), OVERVIEW_SOURCE_TIMEOUT_MS, task.label)
  )));
  const results = new Map(tasks.map((task, index) => [task.key, settled[index]]));
  const valueOf = (key, fallback) => {
    const result = results.get(key);
    return result?.status === 'fulfilled' && result.value != null ? result.value : fallback;
  };
  const sourceStates = Object.fromEntries(tasks.map((task) => {
    const result = results.get(task.key);
    return [task.key, {
      key: task.key,
      label: task.label,
      status: result?.status === 'rejected' ? 'unavailable' : result?.value == null ? 'empty' : 'fresh',
      error: result?.status === 'rejected' ? (result.reason?.message || String(result.reason)) : null,
      checkedAt,
    }];
  }));
  const merchantResult = results.get('merchants');
  if (merchantResult?.status === 'fulfilled') {
    sourceStates.merchants = {
      ...sourceStates.merchants,
      ...merchantSnapshotSourceState(merchantResult.value, Date.parse(checkedAt)),
    };
  }
  const zohoInvoiceSync = valueOf('zohoInvoiceSync', null);
  if (zohoInvoiceSync) {
    const syncedAt = Date.parse(zohoInvoiceSync.last_sync || '');
    const maxSyncAgeMs = 45 * 60 * 1000;
    sourceStates.zohoInvoiceSync = {
      ...sourceStates.zohoInvoiceSync,
      sourceUpdatedAt: zohoInvoiceSync.last_sync || null,
      status: zohoInvoiceSync.last_status === 'error' || zohoInvoiceSync.last_error
        ? 'unavailable'
        : !Number.isFinite(syncedAt) || Date.parse(checkedAt) - syncedAt > maxSyncAgeMs
          ? 'stale'
          : 'fresh',
      error: zohoInvoiceSync.last_error || null,
      message: zohoInvoiceSync.last_status === 'error' || zohoInvoiceSync.last_error
        ? 'آخر مزامنة فواتير Zoho فشلت.'
        : !Number.isFinite(syncedAt)
          ? 'لا يوجد وقت مزامنة صالح لفواتير Zoho.'
          : Date.parse(checkedAt) - syncedAt > maxSyncAgeMs
            ? 'فواتير Zoho لم تُزامن خلال آخر 45 دقيقة.'
            : 'فواتير Zoho محدثة.',
    };
  }

  const thisSnapArr = valueOf('monthly', []);
  const prevSnapArr = valueOf('previousMonth', []);
  const aging = valueOf('apAging', []);
  const carriersAll = valueOf('carrierSpend', []);
  const customersTop = valueOf('customerDebt', []);
  const healthRaw = valueOf('carrierHealth', []);
  const wcArr = valueOf('workingCapital', []);
  const bankBalance = valueOf('banks', null);
  const codNet = valueOf('carrierCod', new Map());
  const zohoDash = valueOf('zohoInvoices', null);
  const zatcaPending = valueOf('zatcaPending', null);
  const customerMoney = valueOf('customerMoney', null);
  const merchantSnapshot = valueOf('merchants', null);
  const lamhaBalance = valueOf('lamhaBalance', null);
  const accountingCycle = valueOf('accountingCycle', null);
  const zohoFinancial = valueOf('zohoFinancial', null);
  const teamReadinessRaw = valueOf('teamReadiness', null);
  const teamStaffing = valueOf('teamStaffing', null);
  const collectionWork = valueOf('collectionWork', null);
  // Availability and freshness are different concerns. A stale Zoho sync or
  // merchant snapshot must block an operational decision, but it must not
  // erase the last successfully read customers from the home page. Build a
  // read-only preview whenever both datasets are readable and expose
  // freshness separately so the UI can label it honestly.
  const customerDecisionDataReadable = sourceStates.customerMoney?.status !== 'unavailable'
    && Array.isArray(customerMoney?.customers)
    && sourceStates.merchants?.status !== 'unavailable'
    && !!merchantSnapshot?.snapshot
    && Array.isArray(merchantSnapshot?.merchants);
  const customerDecisionFresh = customerDecisionDataReadable
    && sourceStates.customerMoney?.status === 'fresh'
    && sourceStates.merchants?.status === 'fresh'
    && sourceStates.zohoInvoiceSync?.status === 'fresh';
  const customerDecisions = customerDecisionDataReadable
    ? buildCustomerDecisions(customerMoney, merchantSnapshot)
    : null;

  const readinessRank = { unavailable: 3, blocked: 2, pilot: 1, ready: 0 };
  const mergeReadiness = (operational, staffing) => {
    if (!operational) return null;
    if (!staffing) return { ...operational, staffing: null, status: 'unavailable' };
    const status = readinessRank[staffing.status] > readinessRank[operational.status]
      ? staffing.status
      : operational.status;
    return { ...operational, staffing, status };
  };
  const collectionOperational = collectionWork && teamReadinessRaw?.sales
    ? {
        ...teamReadinessRaw.sales,
        ...collectionWork,
        status: collectionWork.missing_collection_tasks > 0
          ? 'pilot'
          : teamReadinessRaw.sales.status,
      }
    : null;
  const teamReadiness = teamReadinessRaw ? {
    ...teamReadinessRaw,
    accounting: mergeReadiness(teamReadinessRaw.accounting, teamStaffing?.accounting),
    finance: mergeReadiness(teamReadinessRaw.finance, teamStaffing?.finance),
    sales: mergeReadiness(collectionOperational, teamStaffing?.sales),
  } : null;

  const closeBlockers = [];
  if (sourceStates.accountingCycle?.status === 'unavailable' || !accountingCycle) {
    closeBlockers.push({ source: 'دورة المحاسب', reason: sourceStates.accountingCycle?.error || 'تعذر التحقق من مصادر الإقفال الحرجة.' });
  } else {
    for (const error of accountingCycle.sourceErrors || []) {
      closeBlockers.push({ source: error.label || error.source || 'مصدر إقفال', reason: error.message || 'المصدر غير متاح.' });
    }
    for (const stage of (accountingCycle.stages || []).slice(0, 6)) {
      if (stage.status === 'complete') continue;
      closeBlockers.push({ source: stage.label, reason: stage.reason || 'المرحلة غير مكتملة للفترة المحددة.' });
    }
  }
  const closeReadiness = {
    ready: !!accountingCycle?.prerequisiteComplete && closeBlockers.length === 0,
    checkedAt,
    completed: accountingCycle?.stages?.slice(0, 6).filter(stage => stage.status === 'complete').length || 0,
    required: 6,
    blockers: closeBlockers,
  };

  const thisSnap = (thisSnapArr[0] || {});
  const prevSnap = (prevSnapArr[0] || {});

  const num = (v) => Number(v) || 0;

  // Month-over-month deltas — percentage change. null when prev is 0
  // (can't divide), surfaced in the UI as "—".
  const delta = (a, b) => {
    const x = num(a), y = num(b);
    if (Math.abs(y) < 0.01) return null;
    return +(((x - y) / Math.abs(y)) * 100).toFixed(1);
  };

  // Aging totals across all carriers
  let apTotal = 0, apCurrent = 0, ap3160 = 0, ap6190 = 0, ap90 = 0;
  for (const r of aging) {
    apTotal   += num(r.total_open);
    apCurrent += num(r.current_amt);
    ap3160    += num(r.d31_60);
    ap6190    += num(r.d61_90);
    ap90      += num(r.d90_plus);
  }

  // Uncollected COD across all carriers — mirrors the /money COD-tab
  // banner: sum the positive per-carrier nets (carrier still owes us)
  // and count how many carriers are due. codNet is a Map<carrierId,net>.
  let codOutstandingTotal = 0, codCarriersDue = 0;
  for (const v of (codNet?.values?.() || [])) {
    const n = num(v);
    if (n > 0.5) { codOutstandingTotal += n; codCarriersDue++; }
  }

  return {
    period:     thisPeriod,
    prevPeriod,
    loadedAt: checkedAt,
    sourceStates,
    closeReadiness,
    partial: Object.values(sourceStates).some(source => source.status === 'unavailable'),
    sectionAvailability: {
      monthly: sourceStates.monthly.status !== 'unavailable',
      workingCapital: sourceStates.workingCapital.status !== 'unavailable',
      carrierConcentration: sourceStates.carrierSpend.status !== 'unavailable',
      customerConcentration: [sourceStates.customerMoney, sourceStates.zohoInvoices, sourceStates.customerDebt]
        .some(source => source.status !== 'unavailable'),
      customerDecisions: !!customerDecisions,
      aging: sourceStates.apAging.status !== 'unavailable',
      carrierHealth: sourceStates.carrierHealth.status !== 'unavailable',
    },
    invoiceOperations: {
      draftCount: num(zohoDash?.draft_cnt),
      draftTotal: num(zohoDash?.draft_total),
      zatcaTodayCount: num(zatcaPending?.today_count),
      zatcaTodayTotal: num(zatcaPending?.today_total),
      zatcaOverdueCount: num(zatcaPending?.overdue_count),
      zatcaOverdueTotal: num(zatcaPending?.overdue_total),
      zatcaNeedsLiveCheck: num(zatcaPending?.needs_live_check_count),
      zatcaAvailable: sourceStates.zatcaPending?.status !== 'unavailable',
    },
    merchantPulse: (() => {
      const rows = Array.isArray(merchantSnapshot?.merchants) ? merchantSnapshot.merchants : [];
      const isActive = isLamhaAccountEnabled;
      const asTime = (value) => {
        const stamp = Date.parse(value || '');
        return Number.isFinite(stamp) ? stamp : null;
      };
      const referenceAt = asTime(merchantSnapshot?.snapshot?.uploadedAt) || Date.parse(checkedAt);
      const fiveDaysAgo = referenceAt - (5 * 86_400_000);
      const monthPrefix = `${thisPeriod}-`;
      const recentFiveDays = rows.filter(row => {
        const stamp = asTime(row.last_shipment_at);
        return stamp != null && stamp >= fiveDaysAgo && stamp <= referenceAt;
      });
      const stoppedWithWallet = rows.filter(row => isLamhaLifecycleStopped(row.status) && num(row.wallet_balance) > 0.5);
      const neverShipped = rows.filter(row => num(row.shipment_count) === 0 || !row.last_shipment_at);
      const paidThisPeriod = new Set((customerMoney?.customers || [])
        .filter(row => String(row.last_payment_date || '').startsWith(monthPrefix))
        .map(row => row.store_id || row.zoho_id || row.name)
        .filter(Boolean));
      return {
        available: sourceStates.merchants?.status !== 'unavailable' && !!merchantSnapshot?.snapshot,
        snapshotAt: merchantSnapshot?.snapshot?.uploadedAt || null,
        total: rows.length,
        active: rows.filter(row => isActive(row.status)).length,
        inactive: rows.filter(row => isLamhaAccountDisabled(row.status)).length,
        newThisPeriod: rows.filter(row => String(row.created_at_platform || '').startsWith(monthPrefix)).length,
        recentFiveDays: recentFiveDays.length,
        neverShipped: neverShipped.length,
        stoppedWithWallet: stoppedWithWallet.length,
        stoppedWalletAmount: +stoppedWithWallet.reduce((sum, row) => sum + num(row.wallet_balance), 0).toFixed(2),
        paidThisPeriod: paidThisPeriod.size,
      };
    })(),
    lamhaUploads: {
      merchants: {
        uploadedAt: merchantSnapshot?.snapshot?.uploadedAt || null,
        rowCount: Array.isArray(merchantSnapshot?.merchants) ? merchantSnapshot.merchants.length : null,
        available: sourceStates.merchants?.status !== 'unavailable',
      },
      balance: {
        uploadedAt: lamhaBalance?.uploaded_at || null,
        fileName: lamhaBalance?.file_name || null,
        rowCount: lamhaBalance?.row_count ?? null,
        available: sourceStates.lamhaBalance?.status !== 'unavailable',
      },
    },
    teamReadiness,
    customerDecisions,
    customerDecisionFresh,
    thisMonth: {
      carrierSpend:  num(thisSnap.carrier_spend_gross),
      carrierPaid:   num(thisSnap.carrier_paid),
      codReceived:   num(thisSnap.cod_received),
      driftTotal:    num(thisSnap.drift_total),
      auditsApproved:num(thisSnap.audits_approved),
      auditsPending: num(thisSnap.audits_pending),
      net:           num(thisSnap.cod_received) - num(thisSnap.carrier_spend_gross),
    },
    prevMonth: {
      carrierSpend:  num(prevSnap.carrier_spend_gross),
      carrierPaid:   num(prevSnap.carrier_paid),
      codReceived:   num(prevSnap.cod_received),
      driftTotal:    num(prevSnap.drift_total),
      auditsApproved:num(prevSnap.audits_approved),
      net:           num(prevSnap.cod_received) - num(prevSnap.carrier_spend_gross),
    },
    deltas: {
      carrierSpend: delta(thisSnap.carrier_spend_gross, prevSnap.carrier_spend_gross),
      codReceived:  delta(thisSnap.cod_received,         prevSnap.cod_received),
      net:          delta(
        num(thisSnap.cod_received) - num(thisSnap.carrier_spend_gross),
        num(prevSnap.cod_received) - num(prevSnap.carrier_spend_gross),
      ),
      auditsApproved: delta(thisSnap.audits_approved, prevSnap.audits_approved),
    },
    codOutstanding: {
      total:       +codOutstandingTotal.toFixed(2),
      carriersDue: codCarriersDue,
    },
    aging: {
      rows:    aging.map(r => ({
        carrierId:  r.carrier_id,
        current:    num(r.current_amt),
        d31_60:     num(r.d31_60),
        d61_90:     num(r.d61_90),
        d90:        num(r.d90_plus),
        total:      num(r.total_open),
        oldestAt:   r.oldest_at,
      })),
      totals: {
        current: +apCurrent.toFixed(2),
        d31_60:  +ap3160.toFixed(2),
        d61_90:  +ap6190.toFixed(2),
        d90:     +ap90.toFixed(2),
        total:   +apTotal.toFixed(2),
      },
    },
    customerAging: (() => {
      const source = customerMoney?.aging || {};
      const b0_15 = num(source.b0_15);
      const b16_30 = num(source.b16_30);
      const b31_60 = num(source.b31_60);
      const b61_90 = num(source.b61_90);
      // Opening balances remain available in the customer detail, but they
      // are not current invoices and must not inflate the home-page debt
      // counter or its aging chart. The collectible projection assigns the
      // explicit opening line to the +90 bucket, so remove that exact amount.
      const openingBalance = num(source.opening_balance);
      const b90p = Math.max(0, num(source.b90p) - openingBalance);
      return {
        b0_15,
        b16_30,
        b31_60,
        b61_90,
        b90p,
        openingBalanceExcluded: openingBalance,
        total: +(b0_15 + b16_30 + b31_60 + b61_90 + b90p).toFixed(2),
      };
    })(),
    carrierConcentration: carriersAll.slice(0, topN).map(r => ({
      carrierId:    r.carrier_id,
      spend:        num(r.spend),
      sharePct:     num(r.share_pct),
      auditsCount:  num(r.audits_count),
      rank:         num(r.rank_order),
    })),
    // تركّز المديونيات — من زوهو الحي إن توفّر (كان من snapshot غير مفلتر
    // يعرض عملاء «مستبعدين» غير موجودين في /receivables الافتراضي أصلاً)
    customerConcentration: (Array.isArray(customerMoney?.customers) && customerMoney.customers.length
      ? customerMoney.customers.slice(0, topN).map((d, i) => ({
          customerName: d.name,
          debt:         num(d.owed),
          invoiceCount: num(d.inv_cnt),
          sharePct:     num(customerMoney.outstanding) > 0 ? +((num(d.owed) / num(customerMoney.outstanding)) * 100).toFixed(1) : 0,
          rank:         i + 1,
        }))
      : Array.isArray(zohoDash?.debtors) && zohoDash.debtors.length
      ? zohoDash.debtors.slice(0, topN).map((d, i) => ({
          customerName: d.cust,
          debt:         num(d.owed),
          invoiceCount: num(d.open_cnt),
          sharePct:     num(zohoDash.open_ar) > 0 ? +((num(d.owed) / num(zohoDash.open_ar)) * 100).toFixed(1) : 0,
          rank:         i + 1,
        }))
      : customersTop.map(r => ({
          customerName: r.customer_name,
          debt:         num(r.debt),
          invoiceCount: num(r.invoice_count),
          sharePct:     num(r.share_pct),
          rank:         num(r.rank_order),
        }))),
    arSource: (Array.isArray(customerMoney?.customers) && customerMoney.customers.length)
      || (Array.isArray(zohoDash?.debtors) && zohoDash.debtors.length) ? 'zoho' : 'snapshot',
    // Cash position — the headline question the operator opens
    // /overview to answer: "how much in the bank, how much owed
    // to us, how much we owe, where's the net".
    cashPosition: (() => {
      const wc = wcArr[0] || {};
      // الرصيد من نقطة الحقيقة الوحيدة `loadEffectiveBankBalance` (مجموع ختامي
      // آخر كشف لكل بنك، أو اليدوي حين لا كشوف). **ممنوع إعادة حسابه هنا** —
      // النسخة المكرّرة السابقة كانت تعرض بنكاً واحداً فقط (§1.47).
      const bank = bankBalance?.balance ?? null;
      // AR من زوهو الحي إن توفّر (نفس رقم «تحصيل العملاء» و/zoho-data) —
      // كان من snapshot غير مفلتر (314K) يخالف /receivables (191K) وزوهو (250K)
      const openingBalance = Number(customerMoney?.aging?.opening_balance);
      const operationalAging = customerMoney?.aging || {};
      const invoiceCollectibleAr = Number((
        num(operationalAging.b0_15) + num(operationalAging.b16_30)
        + num(operationalAging.b31_60) + num(operationalAging.b61_90)
        + Math.max(0, num(operationalAging.b90p) - num(operationalAging.opening_balance))
      ).toFixed(2));
      const grossZohoAr = Number(customerMoney?.gross_outstanding ?? zohoDash?.open_ar);
      const creditOffset = Number(customerMoney?.credit_offset);
      const arFromZoho = Number.isFinite(invoiceCollectibleAr) && invoiceCollectibleAr >= 0;
      const totalAR = arFromZoho ? invoiceCollectibleAr : num(wc.total_ar);
      const totalAP = num(wc.total_ap);
      // COD outstanding from the carriers — money they collected and
      // haven't remitted yet. Read from the AP aging totals doesn't
      // capture this; we use the working-capital RPC which already
      // groups carriers we're net-out (we sent COD they haven't
      // remitted). For now compute later if we need; the simple
      // metric below is: AR + Bank − AP.
      const netNoBank = totalAR - totalAP;
      const net       = bank == null ? null : bank + netNoBank;
      return {
        bankBalance:  bank,
        bankBalanceComplete: bankBalance?.complete ?? false,
        bankKnownBalance: bankBalance?.knownBalance ?? null,
        bankExpectedCount: bankBalance?.expectedCount || bankBalance?.banks?.length || 0,
        bankMissingAccounts: bankBalance?.missingBanks || [],
        bankUpdated:  bankBalance?.asOf || null,
        bankSource:   bankBalance?.source || null,
        bankNotes:    bankBalance?.notes || null,
        bankAccounts: bankBalance?.banks || [],   // تفصيل كل بنك وختاميه
        zohoBankAccounts: (zohoFinancial?.banks || [])
          .filter(b => b.display_kind === 'bank' && b.internal_bank_name)
          .map(b => ({
            id: b.zoho_id,
            name: b.account_name,
            internalName: b.internal_bank_name,
            bookBalance: Number(b.book_balance) || 0,
            statementBalance: b.internal_balance == null ? null : Number(b.internal_balance),
            difference: b.internal_vs_book == null ? null : Number(b.internal_vs_book),
            asOf: b.internal_as_of || null,
          })),
        totalAR,                         // owed to us (customers)
        grossAR: Number.isFinite(grossZohoAr) ? grossZohoAr : totalAR,
        customerCreditOffset: Number.isFinite(creditOffset) ? creditOffset : 0,
        openingBalanceExcluded: Number.isFinite(openingBalance) ? openingBalance : 0,
        arSource: arFromZoho ? 'zoho' : 'snapshot',
        totalAP,                         // we owe (vendors/carriers)
        netNoBank:    +netNoBank.toFixed(2),
        net:          net != null ? +net.toFixed(2) : null,
      };
    })(),
    workingCapital: (() => {
      const r = wcArr[0] || {};
      return {
        dso:                num(r.dso_days),
        dpo:                num(r.dpo_days),
        ccc:                num(r.ccc_days),
        totalAR:            num(r.total_ar),
        totalAP:            num(r.total_ap),
        customersWithDebt:  num(r.customers_with_debt),
        carriersWithDebt:   num(r.carriers_with_debt),
        topSlowCustomers:   r.top_slow_customers || [],
        topSlowCarriers:    r.top_slow_carriers  || [],
      };
    })(),
    carrierHealth: healthRaw.map(r => {
      const driftPct    = num(r.drift_pct);
      const mismatchPct = num(r.mismatch_pct);
      const firstPass   = num(r.first_pass_rate);
      // الدرجة الموحّدة من carrierScore.js — نفس المعادلة التي تستخدمها
      // بطاقات CarrierKpi، فلا يرى المستخدم درجتين متناقضتين لنفس الناقل.
      const { score } = carrierScore({ driftPct, mismatchPct, firstPassRate: firstPass });
      return {
        carrierId:        r.carrier_id,
        auditsCount:      num(r.audits_count),
        auditsApproved:   num(r.audits_approved),
        driftTotal:       num(r.drift_total),
        totalBilledSum:   num(r.total_billed_sum),
        driftPct,
        mismatchTotal:    num(r.mismatch_total),
        shipmentsTotal:   num(r.shipments_total),
        mismatchPct,
        firstPassRate:    firstPass,
        avgApprovalHours: num(r.avg_approval_hours),
        score,
      };
    }),
  };
}

const overviewSourceLabels = {
  monthly: 'أداء الشهر', previousMonth: 'أداء الشهر السابق', apAging: 'أعمار التزامات الناقلين',
  carrierSpend: 'تركيز إنفاق الناقلين', customerDebt: 'تركيز مديونيات العملاء', carrierHealth: 'سلامة الناقلين',
  workingCapital: 'دورة التحصيل والسداد', banks: 'أرصدة البنوك', carrierCod: 'تحصيلات الناقلين',
  zohoInvoices: 'فواتير زوهو', zatcaPending: 'الفواتير المعلقة في زاتكا', customerMoney: 'مديونيات العملاء',
  merchants: 'حالة المتاجر في المنصة', lamhaBalance: 'كشف حساب لمحة', accountingCycle: 'جاهزية إقفال دورة المحاسب',
  zohoInvoiceSync: 'حداثة فواتير Zoho', zohoFinancial: 'الرقابة المالية في زوهو',
  teamReadiness: 'جاهزية التشغيل', teamStaffing: 'تغطية صلاحيات الفريق', collectionWork: 'جاهزية أعمال التحصيل',
};

function uniqueUploadSummary(rows = [], count = 0) {
  const uploads = new Map();
  for (const row of rows) {
    const key = row.upload_id || `${row.carrier_id || ''}:${row.source_file || ''}:${row.upload_date || ''}`;
    if (key && !uploads.has(key)) uploads.set(key, row);
  }
  const list = [...uploads.values()];
  return { count: Number(count) || 0, uploads: list, last: list[0] || null, error: null };
}

function adaptOverviewAccounting(raw = {}) {
  return deriveAccountingCycleStages({
    period: raw.period,
    audits: raw.audits || [], weightExports: raw.weightExports || [],
    shipmentImport: raw.shipmentImports?.[0] || null, shipmentImports: raw.shipmentImports || [],
    auditShipments: raw.auditShipments || [], lamhaShipments: raw.lamhaShipments || [],
    balanceSnapshot: raw.balanceSnapshot || null, merchantSnapshot: raw.merchantSnapshot || null,
    codIn: uniqueUploadSummary(raw.codInRows, raw.codInCount),
    codOut: uniqueUploadSummary(raw.codOutRows, raw.codOutCount),
    events: raw.events || [], cycle: raw.cycle || null, carriers: raw.carriers || [],
    schedules: raw.schedules || [], sourceErrors: raw.sourceErrors || [],
  });
}

function mapCoreVat(row) {
  if (!row) return null;
  const n = value => Number(value) || 0;
  const ageMinutes = row.fetched_at
    ? Math.max(0, Math.floor((Date.now() - new Date(row.fetched_at).getTime()) / 60000)) : null;
  return {
    quarter: row.quarter, from: row.period_from, to: row.period_to,
    outputTax: n(row.output_tax), inputTax: n(row.input_tax), netDue: n(row.net_due),
    sales: n(row.output_amount), isClosed: !!row.is_closed, fetchedAt: row.fetched_at,
    daysLeft: Number(row.days_left) || 0,
    prevNetDue: row.prev_net_due == null ? null : n(row.prev_net_due),
    ageMinutes, isStale: ageMinutes == null || ageMinutes > 90,
  };
}

export function adaptOverviewCore(payload) {
  if (!payload?.sources || !payload?.period) throw new Error('استجابة overview_core غير مكتملة');
  const source = payload.sources;
  const checkedAt = payload.generatedAt || new Date().toISOString();
  const customerMoney = source.customerMoney || null;
  const merchantSnapshot = source.merchants || null;
  const accountingCycle = adaptOverviewAccounting(source.accountingCycleRaw || {});
  const bankBalance = summarizeEffectiveBankBalance(
    source.banks?.manualRows || [], source.banks?.statementRows || [],
  );
  const workingCapital = source.workingCapital?.[0] || {};
  const zohoDash = source.zohoInvoices || null;
  const zatca = source.zatcaPending || null;
  const zohoFinancial = source.zohoFinancial || null;
  const n = value => Number(value) || 0;

  const sourceValues = {
    ...source,
    banks: bankBalance,
    accountingCycle,
  };
  delete sourceValues.accountingCycleRaw;
  delete sourceValues.vat;
  const sourceStates = Object.fromEntries(Object.entries(overviewSourceLabels).map(([key, label]) => {
    const reported = payload.sourceStatus?.[key];
    return [key, {
      key, label, status: reported?.status || (sourceValues[key] == null ? 'empty' : 'fresh'),
      error: reported?.error || null, checkedAt,
    }];
  }));
  sourceStates.merchants = {
    ...sourceStates.merchants,
    ...merchantSnapshotSourceState(merchantSnapshot, Date.parse(checkedAt)),
  };
  const zohoSync = source.zohoInvoiceSync;
  if (zohoSync) {
    const syncedAt = Date.parse(zohoSync.last_sync || '');
    const stale = !Number.isFinite(syncedAt) || Date.parse(checkedAt) - syncedAt > 45 * 60 * 1000;
    sourceStates.zohoInvoiceSync = {
      ...sourceStates.zohoInvoiceSync, sourceUpdatedAt: zohoSync.last_sync || null,
      status: zohoSync.last_status === 'error' || zohoSync.last_error ? 'unavailable' : stale ? 'stale' : 'fresh',
      error: zohoSync.last_error || null,
    };
  }

  const customerDecisionDataReadable = Array.isArray(customerMoney?.customers)
    && !!merchantSnapshot?.snapshot && Array.isArray(merchantSnapshot?.merchants);
  const customerDecisions = customerDecisionDataReadable
    ? buildCustomerDecisions(customerMoney, merchantSnapshot) : null;
  const customerDecisionFresh = customerDecisionDataReadable
    && sourceStates.customerMoney.status === 'fresh'
    && sourceStates.merchants.status === 'fresh'
    && sourceStates.zohoInvoiceSync.status === 'fresh';

  const closeBlockers = [];
  for (const error of accountingCycle.sourceErrors || []) {
    closeBlockers.push({ source: error.label || error.source || 'مصدر إقفال', reason: error.message || 'المصدر غير متاح.' });
  }
  for (const stage of (accountingCycle.stages || []).slice(0, 6)) {
    if (stage.status !== 'complete') closeBlockers.push({ source: stage.label, reason: stage.reason || 'المرحلة غير مكتملة للفترة المحددة.' });
  }
  const closeReadiness = {
    ready: !!accountingCycle.prerequisiteComplete && closeBlockers.length === 0,
    checkedAt, completed: accountingCycle.stages?.slice(0, 6).filter(stage => stage.status === 'complete').length || 0,
    required: 6, blockers: closeBlockers,
  };

  const merchants = merchantSnapshot?.merchants || [];
  const active = isLamhaAccountEnabled;
  const asTime = value => { const stamp = Date.parse(value || ''); return Number.isFinite(stamp) ? stamp : null; };
  const referenceAt = asTime(merchantSnapshot?.snapshot?.uploadedAt) || Date.parse(checkedAt);
  const monthPrefix = `${payload.period}-`;
  const stoppedWithWallet = merchants.filter(row => isLamhaLifecycleStopped(row.status) && n(row.wallet_balance) > 0.5);
  const paidThisPeriod = new Set((customerMoney?.customers || [])
    .filter(row => String(row.last_payment_date || '').startsWith(monthPrefix))
    .map(row => row.store_id || row.zoho_id || row.name).filter(Boolean));
  const merchantPulse = {
    available: !!merchantSnapshot?.snapshot, snapshotAt: merchantSnapshot?.snapshot?.uploadedAt || null,
    total: merchants.length, active: merchants.filter(row => active(row.status)).length,
    inactive: merchants.filter(row => isLamhaAccountDisabled(row.status)).length,
    newThisPeriod: merchants.filter(row => String(row.created_at_platform || '').startsWith(monthPrefix)).length,
    recentFiveDays: merchants.filter(row => {
      const stamp = asTime(row.last_shipment_at);
      return stamp != null && stamp >= referenceAt - 5 * 86_400_000 && stamp <= referenceAt;
    }).length,
    neverShipped: merchants.filter(row => n(row.shipment_count) === 0 || !row.last_shipment_at).length,
    stoppedWithWallet: stoppedWithWallet.length,
    stoppedWalletAmount: +stoppedWithWallet.reduce((sum, row) => sum + n(row.wallet_balance), 0).toFixed(2),
    paidThisPeriod: paidThisPeriod.size,
  };

  const agingSource = customerMoney?.aging || {};
  const openingBalance = n(agingSource.opening_balance);
  const customerAging = {
    b0_15: n(agingSource.b0_15), b16_30: n(agingSource.b16_30),
    b31_60: n(agingSource.b31_60), b61_90: n(agingSource.b61_90),
    b90p: Math.max(0, n(agingSource.b90p) - openingBalance), openingBalanceExcluded: openingBalance,
  };
  customerAging.total = +(customerAging.b0_15 + customerAging.b16_30 + customerAging.b31_60
    + customerAging.b61_90 + customerAging.b90p).toFixed(2);

  const invoiceCollectibleAr = customerAging.total;
  const totalAR = Number.isFinite(invoiceCollectibleAr) ? invoiceCollectibleAr : n(workingCapital.total_ar);
  const totalAP = n(workingCapital.total_ap);
  const bank = bankBalance?.balance ?? null;
  const cashPosition = {
    bankBalance: bank, bankBalanceComplete: bankBalance?.complete ?? false,
    bankKnownBalance: bankBalance?.knownBalance ?? null,
    bankExpectedCount: bankBalance?.expectedCount || bankBalance?.banks?.length || 0,
    bankMissingAccounts: bankBalance?.missingBanks || [], bankUpdated: bankBalance?.asOf || null,
    bankSource: bankBalance?.source || null, bankNotes: bankBalance?.notes || null,
    bankAccounts: bankBalance?.banks || [],
    zohoBankAccounts: (zohoFinancial?.banks || []).filter(b => b.display_kind === 'bank' && b.internal_bank_name).map(b => ({
      id: b.zoho_id, name: b.account_name, internalName: b.internal_bank_name,
      bookBalance: n(b.book_balance), statementBalance: b.internal_balance == null ? null : Number(b.internal_balance),
      difference: b.internal_vs_book == null ? null : Number(b.internal_vs_book), asOf: b.internal_as_of || null,
    })),
    totalAR,
    grossAR: Number.isFinite(Number(customerMoney?.gross_outstanding))
      ? Number(customerMoney.gross_outstanding)
      : Number.isFinite(Number(zohoDash?.open_ar)) ? Number(zohoDash.open_ar) : totalAR,
    customerCreditOffset: n(customerMoney?.credit_offset), openingBalanceExcluded: openingBalance,
    arSource: Number.isFinite(invoiceCollectibleAr) ? 'zoho' : 'snapshot', totalAP,
    netNoBank: +(totalAR - totalAP).toFixed(2), net: bank == null ? null : +(bank + totalAR - totalAP).toFixed(2),
  };

  return {
    overview: {
      period: payload.period, prevPeriod: payload.prevPeriod, loadedAt: checkedAt, sourceStates, closeReadiness,
      customerDecisions, customerDecisionFresh, merchantPulse, customerAging, cashPosition,
      invoiceOperations: {
        draftCount: n(zohoDash?.draft_cnt), draftTotal: n(zohoDash?.draft_total),
        zatcaTodayCount: n(zatca?.today_count), zatcaTodayTotal: n(zatca?.today_total),
        zatcaOverdueCount: n(zatca?.overdue_count), zatcaOverdueTotal: n(zatca?.overdue_total),
        zatcaNeedsLiveCheck: n(zatca?.needs_live_check_count), zatcaAvailable: true,
      },
      lamhaUploads: {
        merchants: { uploadedAt: merchantSnapshot?.snapshot?.uploadedAt || null, rowCount: merchants.length, available: !!merchantSnapshot?.snapshot },
        balance: { uploadedAt: source.lamhaBalance?.uploaded_at || null, fileName: source.lamhaBalance?.file_name || null,
          rowCount: source.lamhaBalance?.row_count ?? null, available: source.lamhaBalance != null },
      },
      readPath: 'overview_core',
    },
    vat: mapCoreVat(source.vat), readPath: 'overview_core',
  };
}

const liteSourceLabels = {
  finance: 'مديونيات العملاء',
  merchants: 'حالة المتاجر في المنصة',
  vat: 'ضريبة القيمة المضافة',
  accountingCycle: 'جاهزية إقفال دورة المحاسب',
};

function adaptLiteSource(key, source, checkedAt) {
  const status = source?.status || 'unavailable';
  return {
    key,
    label: liteSourceLabels[key] || key,
    status,
    checkedAt,
    sourceUpdatedAt: source?.dataAsOf || source?.lastSuccessfulSyncAt || null,
    dataAsOf: source?.dataAsOf || null,
    lastSuccessfulSyncAt: source?.lastSuccessfulSyncAt || null,
    error: source?.error || null,
  };
}

export function adaptOverviewLite(payload) {
  if (!payload?.financial || !payload?.sources || !payload?.period) {
    throw new Error('استجابة overview_core_lite غير مكتملة');
  }
  const checkedAt = payload.generatedAt || new Date().toISOString();
  const sourceStates = Object.fromEntries(Object.entries(liteSourceLabels).map(([key]) => (
    [key, adaptLiteSource(key, payload.sources[key], checkedAt)]
  )));
  // Compatibility aliases keep the current UI labels/drill-downs intact while
  // the actual first-screen contract remains four compact source states.
  sourceStates.customerMoney = sourceStates.finance;
  sourceStates.zohoInvoiceSync = sourceStates.finance;
  sourceStates.banks = {
    key: 'banks', label: 'أرصدة البنوك', status: 'loading', checkedAt,
    sourceUpdatedAt: null,
  };

  const financial = payload.financial || {};
  const aging = financial.aging || {};
  const actions = payload.actions || {};
  const zatca = actions.zatca || {};
  const drafts = actions.draftInvoices || {};
  const customerDecisionFresh = sourceStates.finance.status === 'fresh'
    && sourceStates.merchants.status === 'fresh';

  return {
    overview: {
      period: payload.period,
      loadedAt: checkedAt,
      readPath: 'overview_core_lite',
      lazyStatus: 'pending',
      primarySourceStates: {
        finance: sourceStates.finance,
        merchants: sourceStates.merchants,
        vat: sourceStates.vat,
        accountingCycle: sourceStates.accountingCycle,
      },
      sourceStates,
      closeReadiness: payload.closeReadiness,
      customerDecisions: null,
      customerDecisionSummary: {
        stopPostpaid: actions.stopPostpaid || { count: 0, amount: 0 },
        deductPrepaid: actions.deductPrepaid || { count: 0, amount: 0 },
        activatePostpaid: actions.activatePostpaid || { count: 0 },
      },
      customerDecisionFresh,
      merchantPulse: { available: false, loading: true },
      customerAging: {
        b0_15: Number(aging.b0_15) || 0,
        b16_30: Number(aging.b16_30) || 0,
        b31_60: Number(aging.b31_60) || 0,
        b61_90: Number(aging.b61_90) || 0,
        b90p: Number(aging.b90p) || 0,
        openingBalanceExcluded: Number(aging.openingBalanceExcluded) || 0,
        total: Number(aging.total) || 0,
      },
      cashPosition: {
        // Use the same line-backed operational buckets as the receivables
        // result set. The compatibility field can include a residual cent.
        totalAR: Number(aging.total) || 0,
        openingBalanceExcluded: Number(aging.openingBalanceExcluded) || 0,
        bankBalance: null,
        bankBalanceComplete: false,
        loading: true,
      },
      invoiceOperations: {
        draftCount: Number(drafts.count) || 0,
        draftTotal: Number(drafts.amount) || 0,
        zatcaTodayCount: Number(zatca.count) || 0,
        zatcaTodayTotal: Number(zatca.amount) || 0,
        zatcaOverdueCount: 0,
        zatcaOverdueTotal: 0,
        zatcaNeedsLiveCheck: 0,
        zatcaAvailable: zatca.available !== false,
      },
      lamhaSourceNeedsUpdate: Number(actions.refreshLamhaSources?.count) > 0,
      lamhaUploads: {
        merchants: {
          // The newest merchant snapshot is produced by the authenticated
          // Lamha directory + export sync. It is an API-backed source, not a
          // manual monthly upload requirement.
          apiSyncedAt: payload.sources.merchants?.dataAsOf || null,
          uploadedAt: payload.sources.merchants?.dataAsOf || null,
          rowCount: payload.sources.merchants?.recordCount ?? null,
          available: payload.sources.merchants?.status !== 'unavailable',
        },
        balance: { loading: true, available: false },
      },
      drilldowns: payload.drilldowns || {},
    },
    vat: mapCoreVat(payload.vat),
    readPath: 'overview_core_lite',
  };
}

const OVERVIEW_UPLOAD_EVIDENCE = [
  { key: 'carrier_audits', stage: 'carrier_audits', label: 'فواتير شركات الشحن', action: 'فتح مراجعات الناقلين' },
  { key: 'lamha_shipments', stage: 'lamha_shipments', label: 'Admin Order Export من لمحة', action: 'فتح استيراد الشحنات' },
  { key: 'lamha_collections', stage: 'lamha_collections', label: 'ملف تحصيل لمحة', action: 'فتح رفع التحصيل' },
];

export function summarizeOverviewUploadEvidence(rows, { available = true } = {}) {
  if (!available || !Array.isArray(rows)) {
    return { available: false, items: [], error: 'تعذر قراءة سجل الرفع الحالي.' };
  }
  const successfulFiles = rows.filter(row => (
    row?.status === 'success' && String(row?.file_name || '').trim()
  ));
  return {
    available: true,
    items: OVERVIEW_UPLOAD_EVIDENCE.map((definition) => {
      const event = successfulFiles.find(row => (
        row.stage === definition.stage
        && (!definition.sourceKind || row.source_kind === definition.sourceKind)
      ));
      return {
        ...definition,
        uploaded: !!event,
        uploadedAt: event?.created_at || null,
        fileName: event?.file_name || null,
        rowCount: event?.row_count ?? null,
      };
    }),
  };
}

export function mergeOverviewLiteLazy(overview, merchantPayload, cashPayload, uploadEvidence = null) {
  if (overview?.readPath !== 'overview_core_lite') return overview;
  if (!merchantPayload?.merchantPulse || !cashPayload?.cashPosition) {
    throw new Error('استجابة أقسام overview_core_lite غير مكتملة');
  }
  const bank = cashPayload.cashPosition;
  const totalAR = Number(overview.cashPosition?.totalAR) || 0;
  const totalAP = Number(bank.totalAP) || 0;
  const bankBalance = bank.bankBalance == null ? null : Number(bank.bankBalance);
  const checkedAt = cashPayload.generatedAt || overview.loadedAt || new Date().toISOString();
  const merchantUploads = merchantPayload.lamhaUploads || overview.lamhaUploads || {};
  return {
    ...overview,
    lazyStatus: 'ready',
    merchantPulse: { ...merchantPayload.merchantPulse, loading: false },
    customerDecisionSummary: {
      ...(overview.customerDecisionSummary || {}),
      negativeWallet: {
        count: Number(merchantPayload.merchantPulse.negativeWallet) || 0,
        amount: Number(merchantPayload.merchantPulse.negativeWalletAmount) || 0,
      },
    },
    lamhaUploads: {
      ...merchantUploads,
      merchants: {
        ...(merchantUploads.merchants || {}),
        apiSyncedAt: merchantPayload.source?.dataAsOf
          || merchantPayload.source?.lastSuccessfulSyncAt
          || merchantUploads.merchants?.apiSyncedAt
          || merchantUploads.merchants?.uploadedAt
          || null,
      },
      balance: {
        ...(merchantUploads.balance || {}),
        uploadedAt: merchantUploads.balance?.uploadedAt || null,
        fileName: merchantUploads.balance?.fileName || null,
      },
    },
    operationalUploads: uploadEvidence,
    cashPosition: {
      ...overview.cashPosition,
      ...bank,
      totalAR,
      totalAP,
      netNoBank: +(totalAR - totalAP).toFixed(2),
      net: bankBalance == null ? null : +(bankBalance + totalAR - totalAP).toFixed(2),
      loading: false,
    },
    sourceStates: {
      ...overview.sourceStates,
      merchants: adaptLiteSource('merchants', merchantPayload.source, merchantPayload.generatedAt || overview.loadedAt),
      banks: {
        ...adaptLiteSource('banks', cashPayload.source, checkedAt),
        label: 'أرصدة البنوك',
      },
    },
    primarySourceStates: {
      ...(overview.primarySourceStates || {}),
      merchants: adaptLiteSource('merchants', merchantPayload.source, merchantPayload.generatedAt || overview.loadedAt),
    },
  };
}

export async function loadOverviewLite({ period = null, client = supabase } = {}) {
  const [coreResult, suspensionResult] = await Promise.all([
    withSourceTimeout(
      client.rpc('overview_core_lite', { p_period: period || currentPeriod() }),
      OVERVIEW_SOURCE_TIMEOUT_MS,
      'ملخص مركز القيادة',
    ),
    withSourceTimeout(
      client.rpc('overview_actionable_suspension_lite', {
        p_min_overdue: DEFAULT_SUSPENSION_MIN_OVERDUE,
      }),
      OVERVIEW_SOURCE_TIMEOUT_MS,
      'استحقاق إيقاف حسابات لمحة',
    ),
  ]);
  if (coreResult.error) throw coreResult.error;
  if (suspensionResult.error) throw suspensionResult.error;

  return adaptOverviewLite({
    ...coreResult.data,
    actions: {
      ...(coreResult.data?.actions || {}),
      stopPostpaid: suspensionResult.data || { count: 0, amount: 0 },
    },
  });
}

export async function loadOverviewLiteLazy({ period = null, client = supabase } = {}) {
  const selectedPeriod = period || currentPeriod();
  const uploadEvidencePromise = typeof client.from === 'function'
    ? withSourceTimeout(
        client.from('accounting_cycle_events')
          .select('stage, source_kind, status, file_name, row_count, created_at')
          .eq('period', `${selectedPeriod}-01`)
          .in('stage', ['carrier_audits', 'lamha_shipments', 'lamha_sources', 'lamha_collections'])
          .order('created_at', { ascending: false }),
        OVERVIEW_SOURCE_TIMEOUT_MS,
        'سجل ملفات دورة المحاسب',
      ).catch(error => ({ data: null, error }))
    : Promise.resolve({ data: null, error: new Error('مصدر سجل الرفع غير متاح') });
  const [merchantResult, cashResult, uploadResult] = await Promise.all([
    withSourceTimeout(
      client.rpc('overview_merchant_pulse_lite', { p_period: selectedPeriod }),
      OVERVIEW_SOURCE_TIMEOUT_MS,
      'نبض متاجر لمحة',
    ),
    withSourceTimeout(client.rpc('overview_cash_lite'), OVERVIEW_SOURCE_TIMEOUT_MS, 'الموقف النقدي'),
    uploadEvidencePromise,
  ]);
  if (merchantResult.error) throw merchantResult.error;
  if (cashResult.error) throw cashResult.error;
  return {
    merchant: merchantResult.data,
    cash: cashResult.data,
    uploads: summarizeOverviewUploadEvidence(uploadResult.data, { available: !uploadResult.error }),
  };
}

export async function loadOverviewCore({ period = null, topN = 5, client = supabase } = {}) {
  const { data, error } = await withSourceTimeout(
    client.rpc('overview_core', {
      p_period: period || currentPeriod(), p_top_n: Math.min(20, Math.max(1, Number(topN) || 5)),
    }),
    OVERVIEW_SOURCE_TIMEOUT_MS,
    'ملخص مركز القيادة الموسع',
  );
  if (error) throw error;
  return adaptOverviewCore(data);
}

export async function loadOverviewRead({ period = null, topN = 5, mode = OVERVIEW_READ_MODE, client = supabase } = {}) {
  if (mode === 'lite') {
    try { return await loadOverviewLite({ period, client }); }
    catch (error) {
      console.warn('[overview-read] lite unavailable; using legacy fallback', error?.code || error?.message);
    }
  } else if (mode === 'core') {
    try { return await loadOverviewCore({ period, topN, client }); }
    catch (error) {
      console.warn('[overview-read] core unavailable; using legacy fallback', error?.code || error?.message);
    }
  }
  const [{ loadCurrentVat }, overview] = await Promise.all([
    import('./zohoReportsService.js'), loadOverview({ period, topN }),
  ]);
  const vat = await withSourceTimeout(loadCurrentVat(), 5_000, 'ضريبة زوهو').catch(() => null);
  return { overview, vat, readPath: 'legacy' };
}

export function compareOverviewDecisionSurface(legacy, core) {
  const normalizeClose = value => value ? ({
    ready: !!value.ready,
    completed: Number(value.completed) || 0,
    required: Number(value.required) || 0,
    blockers: (value.blockers || []).map(row => ({ source: row.source, reason: row.reason })),
  }) : null;
  const normalizeVat = value => value ? ({
    quarter: value.quarter, from: value.from, to: value.to,
    outputTax: value.outputTax, inputTax: value.inputTax, netDue: value.netDue,
    sales: value.sales, isClosed: value.isClosed, fetchedAt: value.fetchedAt,
    daysLeft: value.daysLeft, prevNetDue: value.prevNetDue, isStale: value.isStale,
  }) : null;
  const pick = result => ({
    customerDecisions: result?.overview?.customerDecisions,
    customerDecisionFresh: result?.overview?.customerDecisionFresh,
    invoiceOperations: result?.overview?.invoiceOperations,
    merchantPulse: result?.overview?.merchantPulse,
    customerAging: result?.overview?.customerAging,
    cashPosition: result?.overview?.cashPosition,
    closeReadiness: normalizeClose(result?.overview?.closeReadiness),
    lamhaUploads: result?.overview?.lamhaUploads,
    sourceStatus: Object.fromEntries(Object.entries(result?.overview?.sourceStates || {}).map(([key, value]) => [key, value?.status])),
    vat: normalizeVat(result?.vat),
  });
  const a = pick(legacy), b = pick(core);
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [{ field: 'decision_surface', legacy: a, core: b }];
}
