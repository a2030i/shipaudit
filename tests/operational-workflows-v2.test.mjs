import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createSubmissionGuard,
  executeEligibleIndividually,
  isOperationalDataStale,
  selectVisibleResults,
  summarizeBulkPreflight,
  toggleResultSelection,
} from '../src/lib/operationalWorkflows.js';
import {
  DEFAULT_SUSPENSION_MIN_OVERDUE, decisionFinancialImpact, evaluateLamhaStopEligibility,
  filterActionableSuspensionRows,
} from '../src/lib/lamhaDecisionActions.js';

test('result set selection supports a visible page without dropping another page', () => {
  let selection = new Set(['off-page']);
  selection = selectVisibleResults(selection, ['a', 'b'], true);
  assert.deepEqual([...selection].sort(), ['a', 'b', 'off-page']);
  selection = toggleResultSelection(selection, 'a');
  assert.deepEqual([...selection].sort(), ['b', 'off-page']);
  selection = selectVisibleResults(selection, ['a', 'b'], false);
  assert.deepEqual([...selection], ['off-page']);
});

test('result set marks missing and expired source timestamps as stale', () => {
  const now = Date.parse('2026-08-28T12:00:00Z');
  assert.equal(isOperationalDataStale(null, 15 * 60_000, now), true);
  assert.equal(isOperationalDataStale('2026-08-28T11:50:00Z', 15 * 60_000, now), false);
  assert.equal(isOperationalDataStale('2026-08-28T11:40:00Z', 15 * 60_000, now), true);
});

test('bulk preflight separates eligible, ineligible, and review records', () => {
  const preflight = summarizeBulkPreflight([
    { id: 1, state: 'active' },
    { id: 2, state: 'inactive' },
    { id: 3, state: 'unknown' },
  ], row => row.state === 'active'
    ? { status: 'eligible' }
    : row.state === 'unknown'
      ? { status: 'review', reason: 'الحالة غير متاحة' }
      : { status: 'ineligible', reason: 'موقوف سابقًا' });
  assert.equal(preflight.total, 3);
  assert.equal(preflight.eligible.length, 1);
  assert.equal(preflight.ineligible.length, 1);
  assert.equal(preflight.requiresReview.length, 1);
  assert.equal(preflight.ineligible[0].reason, 'موقوف سابقًا');
});

test('individual orchestration exposes partial failure and skipped rows', async () => {
  const preflight = summarizeBulkPreflight([
    { id: 1 }, { id: 2 }, { id: 3 },
  ], row => row.id === 3 ? { status: 'ineligible', reason: 'موقوف سابقًا' } : { status: 'eligible' });
  const progress = [];
  const result = await executeEligibleIndividually({
    preflight,
    keyOf: row => row.id,
    execute: async row => {
      if (row.id === 2) throw new Error('تعذر التحقق من لمحة');
      return { ok: true };
    },
    onProgress: event => progress.push(event.completed),
  });
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.skipped, 1);
  assert.deepEqual(progress, [1, 2]);
});

test('mocked individual action reports a complete success without a real external write', async () => {
  const preflight = summarizeBulkPreflight([{ id: 406 }]);
  const calls = [];
  const result = await executeEligibleIndividually({
    preflight,
    keyOf: row => row.id,
    execute: async row => { calls.push(row.id); return { mocked: true }; },
  });
  assert.deepEqual(calls, [406]);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.results[0].value.mocked, true);
});

test('mocked bulk action reports a total failure explicitly', async () => {
  const preflight = summarizeBulkPreflight([{ id: 406 }, { id: 102 }]);
  const result = await executeEligibleIndividually({
    preflight,
    keyOf: row => row.id,
    execute: async () => { throw new Error('رفض المصدر الخارجي'); },
  });
  assert.equal(result.succeeded, 0);
  assert.equal(result.failed, 2);
  assert.deepEqual(result.results.map(row => row.reason), ['رفض المصدر الخارجي', 'رفض المصدر الخارجي']);
});

test('submission guard prevents a duplicated external write while pending', async () => {
  const guard = createSubmissionGuard();
  let calls = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const first = guard.run(async () => { calls += 1; await pending; return 'done'; });
  const second = guard.run(async () => { calls += 1; return 'duplicate'; });
  assert.equal(first, second);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  assert.equal(await second, 'done');
  assert.equal(guard.busy, false);
});

test('wallet decision preflight only allows a fresh, actively operating Lamha account', () => {
  const now = Date.parse('2026-08-28T12:00:00Z');
  const row = { customer: { storeId: 1258, storeName: 'عينة', walletBalance: -75 } };
  assert.equal(evaluateLamhaStopEligibility(row, {
    ok: true, checkedAt: '2026-08-28T11:55:00Z', store: { canCreateShipments: true },
  }, now).status, 'eligible');
  assert.deepEqual(evaluateLamhaStopEligibility(row, {
    ok: true, checkedAt: '2026-08-28T11:55:00Z', store: { canCreateShipments: false },
  }, now), { status: 'ineligible', reason: 'الحساب موقوف بالفعل' });
  assert.equal(evaluateLamhaStopEligibility(row, {
    ok: false, checkedAt: '2026-08-28T11:55:00Z', error: 'lamha_timeout',
  }, now).status, 'review');
  assert.equal(evaluateLamhaStopEligibility(row, {
    ok: true, checkedAt: '2026-08-28T11:30:00Z', store: { canCreateShipments: true },
  }, now).status, 'review');
});

test('wallet decision impact keeps negative wallet and positive-wallet invoice cases distinct', () => {
  assert.equal(decisionFinancialImpact({ customer: { walletBalance: -42.75 } }, 'negative'), 42.75);
  assert.equal(decisionFinancialImpact({ customer: { walletBalance: 80, owed: 125 } }, 'deduct'), 80);
  assert.equal(decisionFinancialImpact({ customer: { walletBalance: 180, owed: 125 } }, 'deduct'), 125);
});

test('executive suspension signal applies the strict amount threshold and hides confirmed financial holds', () => {
  const rows = [
    { storeId: 1, over30: 100 },
    { storeId: 2, over30: 100.01 },
    { storeId: 3, over30: 450 },
    { storeId: 4, over30: 900 },
  ];
  const filtered = filterActionableSuspensionRows(rows, {
    minAmount: DEFAULT_SUSPENSION_MIN_OVERDUE,
    financialHoldStoreIds: new Set([3]),
    liveStatuses: new Map([[4, { ok: true, store: { canCreateShipments: false } }]]),
  });
  assert.deepEqual(filtered.map(row => row.storeId), [2]);
});

test('command center never exposes raw database errors as an executive blocker', async () => {
  const commandCenter = await readFile(new URL('../src/components/operations/FigmaCommandCenter.jsx', import.meta.url), 'utf8');
  assert.match(commandCenter, /operationalBlockerReason/);
  assert.match(commandCenter, /آخر البيانات المتاحة لا تكفي لتأكيد الجاهزية/);
  assert.doesNotMatch(commandCenter, /firstCloseBlocker\?\.reason\s*\|\|\s*'الإقفال متوقف/);
});

test('operational surfaces share the V2 result, preflight, and action-result contracts', async () => {
  const [money, aging, collections, lamha, walletReview, store, resultSet, campaigns, customerWatch, financeCss] = await Promise.all([
    readFile(new URL('../src/pages/CustomerMoney.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/operations/AgingOperationsQueue.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/Collections.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/LamhaFinancialAccountReview.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/LamhaDecisionActionReview.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/Store360Page.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/operations/OperationalResultSet.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/SmartCampaignCenter.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/CustomerWatch.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/CustomerFinanceCenter.css', import.meta.url), 'utf8'),
  ]);
  assert.match(money, /<OperationalResultSet/);
  assert.match(money, /<ResultSetColumnVisibility/);
  assert.match(money, /<BulkPreflightDialog/);
  assert.match(money, /<LamhaDecisionActionReview rows=\{decisionScopeRows\}/);
  assert.match(money, /enforceFinancialPolicy=\{decisionScopeType === 'stop'\}/);
  assert.doesNotMatch(money, /<LamhaFinancialAccountReview/);
  assert.match(money, /label: 'فحص حالة لمحة ومراجعة الإيقاف', variant: 'primary'/);
  assert.match(money, /\['stop', 'deduct', 'negative'\]/);
  assert.match(money, /decisionSelectionStorageKey/);
  assert.match(money, /الحد الأدنى للمبلغ المتجاوز/);
  assert.match(money, /decisionMinAmount/);
  assert.match(walletReview, /فحص حالة الحسابات مباشرة من لمحة/);
  assert.match(walletReview, /إيقاف الحسابات والتحقق من النتيجة في لمحة/);
  assert.doesNotMatch(money, /label: 'فحص حالة لمحة ومراجعة الإيقاف', variant: 'danger'/);
  assert.match(aging, /<OperationalResultSet/);
  assert.match(collections, /<OperationalResultSet/);
  assert.match(collections, /مهام التحصيل المحلية \+ ذمم Zoho الحية/);
  assert.match(collections, /<details className="collections-analysis-disclosure">/);
  assert.match(collections, /className="collections-today-plan"/);
  assert.match(lamha, /context: 'financial_policy'/);
  assert.match(lamha, /<ActionResult/);
  assert.match(walletReview, /context: enforceFinancialPolicy \? 'financial_policy' : 'direct'/);
  assert.match(walletReview, /mode: 'deactivate'/);
  assert.match(walletReview, /الإيقاف لا يطبّق رصيدًا ولا يسوي فاتورة ولا يكتب في Zoho/);
  assert.match(store, /createSubmissionGuard/);
  assert.match(store, /s360-status-confirm__financial/);
  assert.match(store, /محفظة لمحة/);
  assert.match(resultSet, /sourceState/);
  assert.match(resultSet, /syncing: 'جارٍ التحديث'/);
  assert.match(resultSet, /partial: 'تحديث جزئي'/);
  assert.match(resultSet, /disconnected: 'المصدر غير متصل'/);
  assert.match(resultSet, /allVisibleSelected/);
  assert.match(resultSet, /export function ResultSetColumnVisibility/);
  assert.match(campaigns, /handoffOriginLabel/);
  assert.match(campaigns, /العودة إلى \{handoffOriginLabel\}/);
  assert.doesNotMatch(customerWatch, /بيانات الفواتير: snapshot/);
  assert.match(customerWatch, /decision=negative&returnTo=%2Fcustomer-360/);
  assert.match(financeCss, /@media \(max-width: 1180px\)/);
});
