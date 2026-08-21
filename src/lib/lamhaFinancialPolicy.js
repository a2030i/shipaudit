import { effectiveCollectibleLineKind } from './agingOperations.js';

export const LAMHA_FINANCIAL_GRACE_DAYS = 30;

const money = value => Math.max(0, Number(value) || 0);
const isDraft = value => ['draft', 'مسودة'].includes(String(value || '').trim().toLowerCase());
const numericStoreId = value => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

function linkEntries(links) {
  if (links instanceof Map) return [...links.entries()];
  return (Array.isArray(links) ? links : []).map(link => [link.customer_name, {
    storeId: link.store_id,
    confidence: link.confidence,
    method: link.match_method,
  }]);
}

export function buildLamhaFinancialPolicyRows({
  merchants = [], links = new Map(), lines = [], balanceIssueStoreIds = new Set(),
} = {}) {
  const merchantById = new Map();
  for (const merchant of merchants) {
    const storeId = numericStoreId(merchant?.store_id);
    if (storeId) merchantById.set(storeId, merchant);
  }

  const financeByCustomer = new Map();
  for (const line of lines) {
    const customerName = String(line?.contact_name || '').trim();
    const lineKind = effectiveCollectibleLineKind(line);
    if (!customerName || !['invoice', 'opening_balance'].includes(lineKind)) continue;
    if (lineKind === 'invoice' && isDraft(line?.status)) continue;
    const ageDays = Number(line?.age_days) || 0;
    const amount = money(line?.collectible_amount);
    if (ageDays <= LAMHA_FINANCIAL_GRACE_DAYS || amount <= 0.005) continue;
    const current = financeByCustomer.get(customerName) || {
      amount: 0, invoiceAmount: 0, openingBalanceAmount: 0,
      invoices: new Set(), openingBalances: new Set(), oldestDays: 0,
    };
    current.amount = +(current.amount + amount).toFixed(2);
    if (lineKind === 'opening_balance') {
      current.openingBalanceAmount = +(current.openingBalanceAmount + amount).toFixed(2);
      current.openingBalances.add(String(line?.line_id || `${customerName}:opening:${ageDays}:${amount}`));
    } else {
      current.invoiceAmount = +(current.invoiceAmount + amount).toFixed(2);
      current.invoices.add(String(line?.line_id || line?.invoice_number || `${customerName}:${ageDays}:${amount}`));
    }
    current.oldestDays = Math.max(current.oldestDays, ageDays);
    financeByCustomer.set(customerName, current);
  }

  const byStore = new Map();
  let orphanLinks = 0;
  for (const [rawCustomerName, link] of linkEntries(links)) {
    const customerName = String(rawCustomerName || '').trim();
    const storeId = numericStoreId(link?.storeId);
    if (!customerName || !storeId) continue;
    const merchant = merchantById.get(storeId);
    if (!merchant) { orphanLinks += 1; continue; }
    const current = byStore.get(storeId) || {
      storeId,
      storeName: merchant.store_name || `متجر #${storeId}`,
      phone: merchant.phone || '',
      visualStatus: merchant.status || null,
      customerNames: [],
      overdue30Amount: 0,
      overdue30InvoiceAmount: 0,
      overdue30OpeningBalanceAmount: 0,
      overdue30InvoiceCount: 0,
      overdue30OpeningBalanceCount: 0,
      oldestOverdueDays: 0,
      balanceSyncIssue: false,
    };
    const finance = financeByCustomer.get(customerName);
    current.customerNames.push(customerName);
    if (finance) {
      current.overdue30Amount = +(current.overdue30Amount + finance.amount).toFixed(2);
      current.overdue30InvoiceAmount = +(current.overdue30InvoiceAmount + finance.invoiceAmount).toFixed(2);
      current.overdue30OpeningBalanceAmount = +(current.overdue30OpeningBalanceAmount + finance.openingBalanceAmount).toFixed(2);
      current.overdue30InvoiceCount += finance.invoices.size;
      current.overdue30OpeningBalanceCount += finance.openingBalances.size;
      current.oldestOverdueDays = Math.max(current.oldestOverdueDays, finance.oldestDays);
    }
    current.balanceSyncIssue ||= balanceIssueStoreIds.has(storeId) || balanceIssueStoreIds.has(String(storeId));
    byStore.set(storeId, current);
  }

  const rows = [...byStore.values()].map(row => ({
    ...row,
    customerNames: [...new Set(row.customerNames)],
    policyGroup: row.overdue30Amount > 0.005 ? 'overdue' : 'clear',
    eligible: !row.balanceSyncIssue,
    exclusionReason: row.balanceSyncIssue ? 'فرق مطابقة مالي؛ يلزم حله قبل تغيير الحساب' : null,
  })).sort((a, b) => b.overdue30Amount - a.overdue30Amount || a.storeName.localeCompare(b.storeName, 'ar'));

  return {
    rows,
    linkedStores: rows.length,
    unlinkedStores: Math.max(0, merchantById.size - rows.length),
    orphanLinks,
  };
}

export function lamhaFinancialDecision(row, liveResult) {
  if (!row?.eligible) return { key: 'excluded', label: row?.exclusionReason || 'مستبعد من الإجراء' };
  if (!liveResult) return { key: 'unchecked', label: 'لم يُفحص حساب لمحة' };
  if (!liveResult.ok) return { key: 'error', label: 'فشل فحص حساب لمحة' };
  const active = liveResult.store?.canCreateShipments;
  if (active == null) return { key: 'unknown', label: 'حالة الحساب غير متاحة' };
  if (row.policyGroup === 'overdue' && active === true) {
    return { key: 'deactivate', label: 'مرشح للإيقاف' };
  }
  if (row.policyGroup === 'clear' && active === false) {
    return { key: 'activate', label: 'مرشح للتشغيل' };
  }
  return {
    key: 'aligned',
    label: row.policyGroup === 'overdue' ? 'موقوف كما ينبغي' : 'نشط كما ينبغي',
  };
}

export function policyCandidates(rows, liveResults, action) {
  return (rows || []).filter(row => lamhaFinancialDecision(row, liveResults?.get?.(row.storeId)).key === action);
}
