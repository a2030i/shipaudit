import { isLamhaStatusResultFresh } from './lamhaStoreStatusService.js';
import { lamhaAccountState } from './lamhaAccountState.js';

export const LAMHA_DECISION_TYPES = Object.freeze({
  STOP_OVERDUE: 'stop',
  POSITIVE_WALLET_WITH_INVOICES: 'deduct',
  NEGATIVE_WALLET: 'negative',
});

// حد العرض الافتراضي لإشارة الإيقاف في مركز القيادة. تبقى قاعدة الأهلية
// المالية الأصلية مستقلة، ويمكن للمستخدم تغيير الحد داخل Result Set.
export const DEFAULT_SUSPENSION_MIN_OVERDUE = 100;

export function suspensionDecisionAmount(row) {
  const explicit = Number(row?.over30);
  if (Number.isFinite(explicit)) return Math.max(0, explicit);
  return decisionFinancialImpact(row, LAMHA_DECISION_TYPES.STOP_OVERDUE);
}

export function filterActionableSuspensionRows(rows = [], {
  minAmount = DEFAULT_SUSPENSION_MIN_OVERDUE,
  financialHoldStoreIds = new Set(),
  liveStatuses = new Map(),
} = {}) {
  const holds = financialHoldStoreIds instanceof Set ? financialHoldStoreIds : new Set(financialHoldStoreIds || []);
  return (rows || []).filter(row => {
    if (suspensionDecisionAmount(row) <= Number(minAmount || 0)) return false;
    const storeId = decisionStoreId(row);
    if (holds.has(storeId)) return false;
    return liveStatuses.get(storeId)?.store?.canCreateShipments !== false;
  });
}

export function decisionStoreId(row) {
  const value = Number(row?.customer?.storeId ?? row?.storeId);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

const normalizedBillingType = value => String(value || '').trim().toLowerCase().replace(/\s+/g, '');

export function decisionAccountOperatingState(customer, liveResult = null) {
  if (liveResult?.ok && liveResult.store?.canCreateShipments === true) return 'operating';
  if (liveResult?.ok && liveResult.store?.canCreateShipments === false) return 'stopped';
  const snapshotState = lamhaAccountState(customer?.platformStatus);
  if (snapshotState === 'enabled') return 'operating';
  if (snapshotState === 'disabled') return 'stopped';
  return 'unknown';
}

export function matchesWalletInvoiceDecisionFilters(customer, {
  billing = 'prepaid', walletMin = 0.5, dueMin = 0.5,
  invoices = 'open', account = 'all',
} = {}, liveResult = null) {
  const normalizedBilling = normalizedBillingType(customer?.billingType);
  const billingMatches = billing === 'all'
    || (billing === 'prepaid' && ['دفعمسبق', 'prepaid'].includes(normalizedBilling))
    || (billing === 'postpaid' && ['دفعلاحق', 'postpaid'].includes(normalizedBilling));
  if (!billingMatches) return false;
  if (Number(customer?.walletBalance || 0) <= Number(walletMin ?? 0.5)) return false;
  if (Number(customer?.owed || 0) <= Number(dueMin ?? 0.5)) return false;
  const invoiceCount = Number(customer?.invCnt || 0);
  if (invoices === 'open' && invoiceCount <= 0) return false;
  if (invoices === 'none' && invoiceCount > 0) return false;
  return account === 'all' || decisionAccountOperatingState(customer, liveResult) === account;
}

export function evaluateLamhaStopEligibility(row, liveResult, now = Date.now()) {
  if (!decisionStoreId(row)) return { status: 'ineligible', reason: 'لا يوجد Store ID صالح' };
  if (!liveResult) return { status: 'review', reason: 'لم تُقرأ حالة الحساب من لمحة' };
  if (!liveResult.ok) return { status: 'review', reason: 'تعذر التحقق من حساب لمحة' };
  if (!isLamhaStatusResultFresh(liveResult, now)) return { status: 'review', reason: 'نتيجة فحص لمحة قديمة' };
  if (liveResult.store?.canCreateShipments === true) return { status: 'eligible' };
  if (liveResult.store?.canCreateShipments === false) return { status: 'ineligible', reason: 'الحساب موقوف بالفعل' };
  return { status: 'review', reason: 'حالة تشغيل الحساب غير متاحة' };
}

export function decisionFinancialImpact(row, decision) {
  const customer = row?.customer || row || {};
  if (decision === LAMHA_DECISION_TYPES.NEGATIVE_WALLET) {
    return Math.abs(Math.min(0, Number(customer.walletBalance) || 0));
  }
  if (decision === LAMHA_DECISION_TYPES.POSITIVE_WALLET_WITH_INVOICES) {
    return Math.min(
      Math.max(0, Number(customer.walletBalance) || 0),
      Math.max(0, Number(customer.owed) || 0),
    );
  }
  return Math.max(0,
    Number(customer.inv31_60 || 0)
    + Number(customer.inv61_90 || 0)
    + Number(customer.inv90p || 0)
    + Number(customer.opening || 0));
}

export function decisionTitle(decision) {
  if (decision === LAMHA_DECISION_TYPES.NEGATIVE_WALLET) return 'محافظ سالبة تحتاج إيقاف الحساب';
  if (decision === LAMHA_DECISION_TYPES.POSITIVE_WALLET_WITH_INVOICES) return 'محفظة موجبة مع فواتير غير مسددة';
  return 'حسابات تحتاج مراجعة الإيقاف';
}
