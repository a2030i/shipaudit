import { lamhaAccountState } from './lamhaAccountState.js';
import { LAMHA_DECISION_TYPES } from './lamhaDecisionActions.js';

const numberOrNull = value => {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeBilling = value => String(value || '').trim().toLowerCase().replace(/\s+/g, '');
const DAY_MS = 86_400_000;

export function daysSinceLastShipment(value, now = new Date()) {
  if (!value) return null;
  const shipmentMatch = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const nowMatch = String(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!shipmentMatch || !nowMatch) return null;
  const shipmentDay = Date.UTC(Number(shipmentMatch[1]), Number(shipmentMatch[2]) - 1, Number(shipmentMatch[3]));
  const today = Date.UTC(Number(nowMatch[1]), Number(nowMatch[2]) - 1, Number(nowMatch[3]));
  return Math.max(0, Math.floor((today - shipmentDay) / DAY_MS));
}

export function operationalAccountState(customer = {}) {
  const state = lamhaAccountState(customer.platformStatus);
  if (state === 'enabled') return 'active';
  if (state === 'disabled') return 'inactive';
  return 'unknown';
}

export function matchesCustomerOperationalQuery(row, filters = {}) {
  const customer = row?.customer || {};
  const amount = Number(row?.summary?.amount) || 0;
  const minAmount = numberOrNull(filters.minAmount);
  const maxAmount = numberOrNull(filters.maxAmount);
  if (minAmount != null && amount < minAmount) return false;
  if (maxAmount != null && amount > maxAmount) return false;

  const oldestDays = Number(row?.summary?.oldestDays ?? customer.oldestDays) || 0;
  const minDays = numberOrNull(filters.minDays);
  const maxDays = numberOrNull(filters.maxDays);
  if ((minDays != null || maxDays != null) && row?.operationalAgeScopeMatched === false) return false;
  if (minDays != null && oldestDays <= minDays) return false;
  if (maxDays != null && oldestDays > maxDays) return false;

  const billing = filters.billing || 'all';
  const normalizedBilling = normalizeBilling(customer.billingType);
  if (billing === 'prepaid' && !['دفعمسبق', 'prepaid'].includes(normalizedBilling)) return false;
  if (billing === 'postpaid' && !['دفعلاحق', 'postpaid'].includes(normalizedBilling)) return false;
  if (billing === 'unknown' && normalizedBilling) return false;

  const wallet = Number(customer.walletBalance) || 0;
  const walletState = filters.wallet || 'all';
  if (walletState === 'positive' && wallet <= 0.5) return false;
  if (walletState === 'negative' && wallet >= -0.5) return false;
  if (walletState === 'zero' && Math.abs(wallet) > 0.5) return false;

  const invoiceCount = Number(customer.invCnt) || 0;
  const invoices = filters.invoices || 'all';
  if (invoices === 'open' && invoiceCount <= 0) return false;
  if (invoices === 'none' && invoiceCount > 0) return false;

  const status = filters.status || 'all';
  if (status !== 'all' && operationalAccountState(customer) !== status) return false;

  const shipmentState = filters.shipmentState || 'all';
  const shipmentDays = daysSinceLastShipment(customer.lastShipmentAt, filters.now || new Date());
  if (shipmentState === 'exists' && shipmentDays == null) return false;
  if (shipmentState === 'none' && shipmentDays != null) return false;
  const lastShipmentMinDays = numberOrNull(filters.lastShipmentMinDays);
  const lastShipmentMaxDays = numberOrNull(filters.lastShipmentMaxDays);
  if (lastShipmentMinDays != null && (shipmentDays == null || shipmentDays <= lastShipmentMinDays)) return false;
  if (lastShipmentMaxDays != null && (shipmentDays == null || shipmentDays > lastShipmentMaxDays)) return false;

  const sharedContact = filters.sharedContact || 'all';
  const sharedCount = Number(customer.sharedContactStoreCount) || 0;
  if (sharedContact === 'with' && sharedCount <= 0) return false;
  if (sharedContact === 'without' && sharedCount > 0) return false;
  return true;
}

export function filterCustomerOperationalRows(rows = [], filters = {}) {
  return rows.filter(row => matchesCustomerOperationalQuery(row, filters));
}

export function scopeRowsToOperationalAge(rows = [], lines = [], filters = {}) {
  const minDays = numberOrNull(filters.minDays);
  const maxDays = numberOrNull(filters.maxDays);
  if (minDays == null && maxDays == null) return rows;
  const aging = filters.aging instanceof Set ? filters.aging : new Set(filters.aging || []);
  const byZoho = new Map();
  for (const line of lines) {
    const zohoId = String(line.contact_id ?? line.contactId ?? '');
    if (!zohoId) continue;
    const invoiceNumber = String(line.invoice_number || '');
    const kind = line.line_kind === 'opening_balance'
      || (line.line_kind === 'invoice' && invoiceNumber.includes('الرصيد الافتتاحي'))
      ? 'opening_balance'
      : line.line_kind;
    if (kind !== 'invoice') continue;
    const ageDays = Number(line.age_days) || 0;
    if (minDays != null && ageDays <= minDays) continue;
    if (maxDays != null && ageDays > maxDays) continue;
    if (aging.size) {
      const inBucket = (aging.has('inv1_15') && ageDays >= 1 && ageDays <= 15)
        || (aging.has('inv16_30') && ageDays >= 16 && ageDays <= 30)
        || (aging.has('inv31_60') && ageDays >= 31 && ageDays <= 60)
        || (aging.has('inv61_90') && ageDays >= 61 && ageDays <= 90)
        || (aging.has('inv90p') && ageDays > 90);
      if (!inBucket) continue;
    }
    const current = byZoho.get(zohoId) || {
      amount: 0, invoiceCount: 0, openingCount: 0, oldestDays: 0, oldestDueDate: null,
    };
    current.amount += Number(line.collectible_amount ?? line.balance) || 0;
    current.invoiceCount += 1;
    current.oldestDays = Math.max(current.oldestDays, ageDays);
    const dueDate = line.due_date || line.line_date || null;
    if (dueDate && (!current.oldestDueDate || dueDate < current.oldestDueDate)) current.oldestDueDate = dueDate;
    byZoho.set(zohoId, current);
  }
  return rows.map(row => {
    const matched = byZoho.has(String(row.customer?.zohoId || ''));
    const scoped = byZoho.get(String(row.customer?.zohoId || '')) || {
      amount: 0, invoiceCount: 0, openingCount: 0, oldestDays: 0, oldestDueDate: null,
    };
    return {
      ...row,
      operationalAgeScopeMatched: matched,
      customer: { ...row.customer, invCnt: scoped.invoiceCount, oldestDays: scoped.oldestDays },
      summary: { ...row.summary, ...scoped, amount: Number(scoped.amount.toFixed(2)) },
      reason: `لديه ${scoped.invoiceCount} فاتورة داخل نطاق العمر المحدد`,
    };
  });
}

export function hasExtendedOperationalFilters(filters = {}) {
  return Boolean(
    numberOrNull(filters.minDays) != null
    || numberOrNull(filters.maxDays) != null
    || numberOrNull(filters.lastShipmentMinDays) != null
    || numberOrNull(filters.lastShipmentMaxDays) != null
    || !['', 'all'].includes(filters.billing || 'all')
    || !['', 'all'].includes(filters.wallet || 'all')
    || !['', 'all'].includes(filters.invoices || 'all')
    || !['', 'all'].includes(filters.status || 'all')
    || !['', 'all'].includes(filters.shipmentState || 'all')
    || !['', 'all'].includes(filters.sharedContact || 'all'),
  );
}

// يختار مسار الأهلية الموافق للسيناريوهات المعتمدة سابقًا. أي تركيب آخر
// يبقى تحت الحارس المالي ولا يتحول إلى صلاحية إيقاف عامة.
export function operationalSuspensionReview(filters = {}) {
  if (filters.wallet === 'negative') {
    return { decision: LAMHA_DECISION_TYPES.NEGATIVE_WALLET, enforceFinancialPolicy: false };
  }
  if (filters.wallet === 'positive' && filters.invoices === 'open' && filters.billing === 'prepaid') {
    return { decision: LAMHA_DECISION_TYPES.POSITIVE_WALLET_WITH_INVOICES, enforceFinancialPolicy: false };
  }
  return { decision: LAMHA_DECISION_TYPES.STOP_OVERDUE, enforceFinancialPolicy: true };
}
