import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildLamhaFinancialPolicyRows, lamhaFinancialDecision, policyCandidates,
} from '../src/lib/lamhaFinancialPolicy.js';
import {
  isLamhaStatusResultFresh, lamhaStatusFailureLabel, needsLamhaStatusRefresh,
} from '../src/lib/lamhaStoreStatusService.js';

const merchants = [
  { store_id: 10, store_name: 'متجر ألف', status: 'متوقف' },
  { store_id: 20, store_name: 'متجر باء', status: 'نشط' },
  { store_id: 30, store_name: 'بلا ربط', status: 'نشط' },
];
const links = new Map([
  ['عميل ألف', { storeId: 10 }],
  ['فرع ألف', { storeId: 10 }],
  ['عميل باء', { storeId: 20 }],
]);
const lines = [
  { contact_name: 'عميل ألف', line_kind: 'invoice', line_id: 'a', age_days: 31, collectible_amount: 100 },
  { contact_name: 'فرع ألف', line_kind: 'invoice', line_id: 'b', age_days: 91, collectible_amount: 50 },
  { contact_name: 'عميل ألف', line_kind: 'invoice', line_id: 'c', age_days: 30, collectible_amount: 700 },
  { contact_name: 'عميل ألف', line_kind: 'opening_balance', line_id: 'o', age_days: 500, collectible_amount: 900 },
  { contact_name: 'عميل ألف', line_kind: 'invoice', line_id: 'draft', status: 'draft', age_days: 120, collectible_amount: 5000 },
];

test('financial policy includes old opening balances, excludes drafts, and separates the displayed amounts', () => {
  const result = buildLamhaFinancialPolicyRows({ merchants, links, lines });
  assert.equal(result.rows.length, 2);
  assert.equal(result.unlinkedStores, 1);
  const store = result.rows.find(row => row.storeId === 10);
  assert.equal(store.overdue30Amount, 1050);
  assert.equal(store.overdue30InvoiceAmount, 150);
  assert.equal(store.overdue30OpeningBalanceAmount, 900);
  assert.equal(store.overdue30InvoiceCount, 2);
  assert.equal(store.overdue30OpeningBalanceCount, 1);
  assert.equal(store.oldestOverdueDays, 500);
  assert.equal(store.policyGroup, 'overdue');
  assert.deepEqual(store.customerNames, ['عميل ألف', 'فرع ألف']);
});

test('bulk decisions use live Lamha account state, never the visual merchant status', () => {
  const { rows } = buildLamhaFinancialPolicyRows({ merchants, links, lines });
  const overdue = rows.find(row => row.storeId === 10);
  const clear = rows.find(row => row.storeId === 20);
  const live = new Map([
    [10, { ok: true, store: { canCreateShipments: true } }],
    [20, { ok: true, store: { canCreateShipments: false } }],
  ]);
  assert.equal(lamhaFinancialDecision(overdue, live.get(10)).key, 'deactivate');
  assert.equal(lamhaFinancialDecision(clear, live.get(20)).key, 'protected');
  assert.equal(lamhaFinancialDecision(clear, live.get(20), { financialHold: true }).key, 'activate');
  assert.deepEqual(policyCandidates(rows, live, 'deactivate').map(row => row.storeId), [10]);
  assert.deepEqual(policyCandidates(rows, live, 'activate').map(row => row.storeId), []);
  assert.deepEqual(policyCandidates(rows, live, 'activate', new Set([20])).map(row => row.storeId), [20]);
});

test('balance mismatches and stores without explicit links cannot be changed automatically', () => {
  const result = buildLamhaFinancialPolicyRows({ merchants, links, lines, balanceIssueStoreIds: new Set([10]) });
  const row = result.rows.find(item => item.storeId === 10);
  assert.equal(row.eligible, false);
  assert.equal(lamhaFinancialDecision(row, { ok: true, store: { canCreateShipments: true } }).key, 'excluded');
  assert.equal(result.rows.some(item => item.storeId === 30), false);
});

test('saved Lamha observations are reused only inside the freshness window', () => {
  const now = Date.parse('2026-08-21T05:00:00.000Z');
  const recent = { ok: true, checkedAt: '2026-08-21T04:50:00.000Z' };
  const stale = { ok: true, checkedAt: '2026-08-21T04:40:00.000Z' };
  const failed = { ok: false, checkedAt: '2026-08-21T04:59:00.000Z' };
  assert.equal(isLamhaStatusResultFresh(recent, now), true);
  assert.equal(needsLamhaStatusRefresh(recent, now), false);
  assert.equal(isLamhaStatusResultFresh(stale, now), false);
  assert.equal(needsLamhaStatusRefresh(stale, now), true);
  assert.equal(needsLamhaStatusRefresh(failed, now), true);
});

test('financial policy excludes residual balances up to 0.50 and admits 0.51 exactly', () => {
  const thresholdMerchants = [
    { store_id: 40, store_name: 'رصيد هامشي', status: 'نشط' },
    { store_id: 50, store_name: 'رصيد تشغيلي', status: 'نشط' },
  ];
  const thresholdLinks = new Map([
    ['عميل هامشي', { storeId: 40 }],
    ['عميل تشغيلي', { storeId: 50 }],
  ]);
  const thresholdLines = [
    { contact_name: 'عميل هامشي', line_kind: 'opening_balance', line_id: 'r1', age_days: 90, collectible_amount: 0.01 },
    { contact_name: 'عميل هامشي', line_kind: 'opening_balance', line_id: 'r2', age_days: 90, collectible_amount: 0.50 },
    { contact_name: 'عميل تشغيلي', line_kind: 'invoice', line_id: 'c1', age_days: 31, collectible_amount: 0.51 },
  ];

  const { rows } = buildLamhaFinancialPolicyRows({
    merchants: thresholdMerchants,
    links: thresholdLinks,
    lines: thresholdLines,
  });
  const residual = rows.find(row => row.storeId === 40);
  const collectible = rows.find(row => row.storeId === 50);

  assert.equal(residual.overdue30Amount, 0);
  assert.equal(residual.policyGroup, 'clear');
  assert.equal(collectible.overdue30Amount, 0.51);
  assert.equal(collectible.overdue30InvoiceCount, 1);
  assert.equal(collectible.policyGroup, 'overdue');
});

test('Lamha read failures stay diagnostically distinct without exposing raw responses', () => {
  assert.equal(
    lamhaStatusFailureLabel({ ok: false, error: 'lamha_store_not_found', http: 404 }),
    'رقم المتجر غير موجود في واجهة موظف لمحة أو خارج نطاق التوكن · HTTP 404',
  );
  assert.equal(
    lamhaStatusFailureLabel({ ok: false, error: 'lamha_rate_limited', http: 429 }),
    'وصل فحص لمحة إلى حد الطلبات المؤقت · HTTP 429',
  );
  assert.equal(lamhaStatusFailureLabel({ ok: true }), null);
});

test('UI requires review, refreshes finance before writes, and keeps Lamha throttling in the shared runner', async () => {
  const component = await readFile(new URL('../src/components/LamhaFinancialAccountReview.jsx', import.meta.url), 'utf8');
  const page = await readFile(new URL('../src/pages/CustomerMoney.jsx', import.meta.url), 'utf8');
  const service = await readFile(new URL('../src/lib/lamhaStoreStatusService.js', import.meta.url), 'utf8');
  const merchantsService = await readFile(new URL('../src/lib/merchantsService.js', import.meta.url), 'utf8');
  assert.match(page, /ضبط حسابات لمحة/);
  assert.match(component, /loadLamhaFinancialPolicyData\(\)/);
  assert.match(component, /تغيرت البيانات المالية/);
  assert.match(component, /مراجعة إيقاف/);
  assert.match(component, /مراجعة تشغيل/);
  assert.match(service, /runLamhaStoreOperation/);
  assert.match(service, /loadCachedLamhaStoreStatuses/);
  assert.match(service, /LAMHA_STATUS_FRESH_MS/);
  assert.match(service, /LAMHA_BATCH_SIZE = 10/);
  assert.match(component, /فحص من زال عنهم الحجز المالي/);
  assert.match(component, /needsLamhaStatusRefresh/);
  const edge = await readFile(new URL('../supabase/functions/lamha-store-status/index.ts', import.meta.url), 'utf8');
  assert.match(edge, /restore-scan/);
  assert.match(edge, /STATUS_SCAN_ACTION/);
  assert.match(edge, /financial_policy/);
  assert.match(edge, /READ_RETRY_LIMIT = 1/);
  assert.match(edge, /TRANSIENT_HTTP_STATUSES/);
  assert.match(edge, /lamha_identifier_mismatch/);
  assert.match(edge, /responseStoreId/);
  assert.match(edge, /failureClass/);
  assert.doesNotMatch(edge, /payload:\s*payload/);
  assert.match(merchantsService, /customer_merchant_links'[\s\S]*?\.range\(from, from \+ PAGE - 1\)/);
});
