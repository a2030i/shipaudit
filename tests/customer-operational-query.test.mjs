import test from 'node:test';
import assert from 'node:assert/strict';
import {
  daysSinceLastShipment,
  filterCustomerOperationalRows, hasExtendedOperationalFilters,
  matchesCustomerOperationalQuery, operationalSuspensionReview, scopeRowsToOperationalAge,
} from '../src/lib/customerOperationalQuery.js';
import { readFile } from 'node:fs/promises';

const row = (overrides = {}) => ({
  identityKey: `store:${overrides.storeId || 1}`,
  customer: {
    storeId: 1, billingType: 'دفع لاحق', walletBalance: 0,
    platformStatus: 'active', invCnt: 2, lastShipmentAt: '2026-08-20',
    sharedContactStoreCount: 0, ...overrides,
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

test('حد المبلغ يطبق على مبلغ نطاق العمر نفسه لا على إجمالي العميل', () => {
  const rows = scopeRowsToOperationalAge([row({ zohoId: 'z1' })], [
    { contact_id: 'z1', line_kind: 'invoice', invoice_number: 'INV-1', age_days: 10, collectible_amount: 500, due_date: '2026-08-19' },
    { contact_id: 'z1', line_kind: 'invoice', invoice_number: 'INV-2', age_days: 45, collectible_amount: 80, due_date: '2026-07-15' },
    { contact_id: 'z1', line_kind: 'opening_balance', age_days: 200, collectible_amount: 900, due_date: '2026-01-01' },
  ], { minDays: 30, aging: new Set() });
  assert.equal(rows[0].summary.amount, 80);
  assert.equal(rows[0].summary.invoiceCount, 1);
  assert.equal(matchesCustomerOperationalQuery(rows[0], { minDays: 30, minAmount: 100 }), false);
  assert.equal(matchesCustomerOperationalQuery(rows[0], { minDays: 30, minAmount: 80 }), true);
});

test('غياب فاتورة داخل نطاق العمر يستبعد الرصيد الافتتاحي حتى في نطاق الحد الأعلى فقط', () => {
  assert.equal(matchesCustomerOperationalQuery({
    operationalAgeScopeMatched: false,
    customer: { invCnt: 0 },
    summary: { amount: 0, oldestDays: 0 },
  }, { maxDays: '30' }), false);
});

test('آخر شحنة والمتاجر المشتركة في الجوال شروط مستقلة', () => {
  const now = new Date('2026-08-29T12:00:00+03:00');
  assert.equal(daysSinceLastShipment('2026-08-20T23:00:00Z', now), 9);
  assert.equal(matchesCustomerOperationalQuery(row({
    lastShipmentAt: '2026-08-20', sharedContactStoreCount: 2,
  }), { lastShipmentMinDays: 5, sharedContact: 'with', now }), true);
  assert.equal(matchesCustomerOperationalQuery(row({
    lastShipmentAt: '2026-08-28', sharedContactStoreCount: 2,
  }), { lastShipmentMinDays: 5, now }), false);
  assert.equal(matchesCustomerOperationalQuery(row({
    lastShipmentAt: null,
  }), { shipmentState: 'none', now }), true);
  assert.equal(matchesCustomerOperationalQuery(row({
    sharedContactStoreCount: 0,
  }), { sharedContact: 'with', now }), false);
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
  assert.equal(hasExtendedOperationalFilters({ lastShipmentMinDays: '5' }), true);
  assert.equal(hasExtendedOperationalFilters({ sharedContact: 'with' }), true);
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
  assert.match(queue, /متاجر بنفس رقم التواصل/);
  assert.match(queue, /الحد الأدنى لأيام آخر شحنة/);
  assert.match(resultSet, /حدد عميلًا أو أكثر لتفعيل الإجراء/);
  assert.match(launcher, /\/customer-money\?worklist=1/);
});

test('المسار الاحتياطي يطبق نفس شروط التشغيل قبل إتاحة الإجراء الجماعي', async () => {
  const page = await readFile(new URL('../src/pages/CustomerMoney.jsx', import.meta.url), 'utf8');
  assert.match(page, /if \(!matchesCustomerOperationalQuery\(row, agingFilterState\)\) return false/);
});
