import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterCustomerOperationalRows, hasExtendedOperationalFilters,
  matchesCustomerOperationalQuery, operationalSuspensionReview,
} from '../src/lib/customerOperationalQuery.js';
import { readFile } from 'node:fs/promises';

const row = (overrides = {}) => ({
  identityKey: `store:${overrides.storeId || 1}`,
  customer: {
    storeId: 1, billingType: 'دفع لاحق', walletBalance: 0,
    platformStatus: 'active', invCnt: 2, ...overrides,
  },
  summary: { amount: 250, oldestDays: 45 },
});

test('تجمع شروط العمر والدفع والمحفظة والفواتير وحالة الحساب بمنطق AND', () => {
  assert.equal(matchesCustomerOperationalQuery(row(), {
    minDays: 30, billing: 'postpaid', wallet: 'zero', invoices: 'open', status: 'active',
  }), true);
  assert.equal(matchesCustomerOperationalQuery(row(), { minDays: 45 }), false);
  assert.equal(matchesCustomerOperationalQuery(row(), { billing: 'prepaid' }), false);
  assert.equal(matchesCustomerOperationalQuery(row(), { invoices: 'none' }), false);
});

test('حد المحفظة التشغيلي لا يصنف ±0.50 كموجب أو سالب', () => {
  assert.equal(matchesCustomerOperationalQuery(row({ walletBalance: 0.5 }), { wallet: 'positive' }), false);
  assert.equal(matchesCustomerOperationalQuery(row({ walletBalance: 0.51 }), { wallet: 'positive' }), true);
  assert.equal(matchesCustomerOperationalQuery(row({ walletBalance: -0.5 }), { wallet: 'negative' }), false);
  assert.equal(matchesCustomerOperationalQuery(row({ walletBalance: -0.51 }), { wallet: 'negative' }), true);
});

test('حالة تشغيل لمحة تتبع قاعدة inactive فقط = موقوف', () => {
  assert.equal(matchesCustomerOperationalQuery(row({ platformStatus: 'idle' }), { status: 'active' }), true);
  assert.equal(matchesCustomerOperationalQuery(row({ platformStatus: 'inactive' }), { status: 'inactive' }), true);
});

test('الترشيح يعيد جمهورًا واحدًا من شروط متغيرة', () => {
  const rows = [
    row({ storeId: 1, walletBalance: 90, billingType: 'دفع مسبق' }),
    row({ storeId: 2, walletBalance: -25, billingType: 'دفع مسبق' }),
    row({ storeId: 3, walletBalance: 0, billingType: 'دفع لاحق' }),
  ];
  assert.deepEqual(filterCustomerOperationalRows(rows, {
    billing: 'prepaid', wallet: 'positive', invoices: 'open',
  }).map(item => item.customer.storeId), [1]);
});

test('مسار مراجعة الإيقاف لا يوسع الصلاحية خارج السيناريوهات المعتمدة', () => {
  assert.deepEqual(operationalSuspensionReview({ wallet: 'negative' }), {
    decision: 'negative', enforceFinancialPolicy: false,
  });
  assert.deepEqual(operationalSuspensionReview({ wallet: 'positive', invoices: 'open', billing: 'prepaid' }), {
    decision: 'deduct', enforceFinancialPolicy: false,
  });
  assert.deepEqual(operationalSuspensionReview({ minDays: '30', billing: 'postpaid' }), {
    decision: 'stop', enforceFinancialPolicy: true,
  });
  assert.equal(hasExtendedOperationalFilters({ minDays: '30' }), true);
});

test('واجهة التنفيذ تبدأ بشروط حرة وتكشف الإجراءات بعد التحديد', async () => {
  const [queue, resultSet, launcher] = await Promise.all([
    readFile(new URL('../src/components/operations/AgingOperationsQueue.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/operations/OperationalResultSet.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/QuickActionLauncher.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(queue, /ضع شروطك وأنشئ قائمة التنفيذ/);
  assert.match(queue, /showActionsWhenEmpty: false/);
  assert.match(queue, /إيقاف الحسابات/);
  assert.match(queue, /حملة WhatsApp/);
  assert.match(resultSet, /حدد عميلًا أو أكثر لتفعيل الإجراء/);
  assert.match(launcher, /\/customer-money\?worklist=1/);
});

test('المسار الاحتياطي يطبق نفس شروط التشغيل قبل إتاحة الإجراء الجماعي', async () => {
  const page = await readFile(new URL('../src/pages/CustomerMoney.jsx', import.meta.url), 'utf8');
  assert.match(page, /if \(!matchesCustomerOperationalQuery\(row, agingFilterState\)\) return false/);
});
