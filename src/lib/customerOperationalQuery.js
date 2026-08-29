import { lamhaAccountState } from './lamhaAccountState.js';
import { LAMHA_DECISION_TYPES } from './lamhaDecisionActions.js';

const numberOrNull = value => {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeBilling = value => String(value || '').trim().toLowerCase().replace(/\s+/g, '');

export function operationalAccountState(customer = {}) {
  const state = lamhaAccountState(customer.platformStatus);
  if (state === 'enabled') return 'active';
  if (state === 'disabled') return 'inactive';
  return 'unknown';
}

export function matchesCustomerOperationalQuery(row, filters = {}) {
  const customer = row?.customer || {};
  const oldestDays = Number(row?.summary?.oldestDays ?? customer.oldestDays) || 0;
  const minDays = numberOrNull(filters.minDays);
  const maxDays = numberOrNull(filters.maxDays);
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
  return true;
}

export function filterCustomerOperationalRows(rows = [], filters = {}) {
  return rows.filter(row => matchesCustomerOperationalQuery(row, filters));
}

export function hasExtendedOperationalFilters(filters = {}) {
  return Boolean(
    numberOrNull(filters.minDays) != null
    || numberOrNull(filters.maxDays) != null
    || !['', 'all'].includes(filters.billing || 'all')
    || !['', 'all'].includes(filters.wallet || 'all')
    || !['', 'all'].includes(filters.invoices || 'all')
    || !['', 'all'].includes(filters.status || 'all'),
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
