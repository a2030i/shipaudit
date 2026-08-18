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
const isPlatformActive = (value) => ['نشط', 'active', 'مفعل'].includes(platformKey(value));
const isPlatformInactive = (value) => ['غيرنشط', 'inactive', 'موقوف', 'متوقف'].includes(platformKey(value));

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
  const { loadLatestMerchants, merchantSnapshotSourceState } = await import('./merchantsService.js');
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
      const normalize = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '');
      const isActive = (value) => ['نشط', 'active', 'مفعل'].includes(normalize(value));
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
      const stoppedWithWallet = rows.filter(row => !isActive(row.status) && num(row.wallet_balance) > 0.5);
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
        inactive: rows.filter(row => !isActive(row.status)).length,
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
      const collectibleAr = Number(customerMoney?.outstanding);
      const openingBalance = Number(customerMoney?.aging?.opening_balance);
      const invoiceCollectibleAr = Number.isFinite(collectibleAr) && Number.isFinite(openingBalance)
        ? Math.max(0, collectibleAr - openingBalance)
        : collectibleAr;
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
