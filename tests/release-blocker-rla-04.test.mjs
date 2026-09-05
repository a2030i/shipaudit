import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildStore360Url } from '../src/lib/store360Navigation.js';
import { reportReturnPath, withWorkspaceReturn } from '../src/lib/workspaceJourneyNavigation.js';

const ORIGIN = 'https://shipaudit.local';
const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const reportUrl = '/workspace/reports?dateFrom=2026-08-01&dateTo=2026-09-04&domain=sales&custom=keep-me';
const salesUrl = withWorkspaceReturn('/workspace/sales?view=overview', {
  source: 'reports',
  returnTo: reportUrl,
});

const withNeverShipped = value => {
  const target = new URL(value, ORIGIN);
  target.searchParams.set('performanceFilter', 'never_shipped');
  return `${target.pathname}?${target.searchParams.toString()}`;
};

test('RLA-04: the originating reports URL contains its complete date context', () => {
  const origin = new URL(reportUrl, ORIGIN);
  assert.equal(origin.searchParams.get('dateFrom'), '2026-08-01');
  assert.equal(origin.searchParams.get('dateTo'), '2026-09-04');
});

test('RLA-04: opening the growth report retains the complete parent context', () => {
  const target = new URL(salesUrl, ORIGIN);
  assert.equal(target.pathname, '/workspace/sales');
  assert.equal(target.searchParams.get('view'), 'overview');
  assert.equal(target.searchParams.get('source'), 'reports');
  assert.equal(target.searchParams.get('returnTo'), reportUrl);
});

test('RLA-04: the never-shipped result set preserves its parent report context', () => {
  const resultSetUrl = withNeverShipped(salesUrl);
  const target = new URL(resultSetUrl, ORIGIN);
  assert.equal(target.searchParams.get('performanceFilter'), 'never_shipped');
  assert.equal(target.searchParams.get('source'), 'reports');
  assert.equal(target.searchParams.get('returnTo'), reportUrl);
});

test('RLA-04: Customer 360 returns one level to the complete result set URL', () => {
  const resultSetUrl = withNeverShipped(salesUrl);
  const detailUrl = buildStore360Url({
    storeId: 2240,
    source: 'lamha-store-performance',
    returnTo: resultSetUrl,
  });
  const detail = new URL(detailUrl, ORIGIN);
  assert.equal(detail.searchParams.get('customer'), '2240');
  assert.equal(detail.searchParams.get('returnTo'), resultSetUrl);
});

test('RLA-04: returning from Customer 360 restores the same result set', () => {
  const resultSetUrl = withNeverShipped(salesUrl);
  const detailUrl = buildStore360Url({
    storeId: 2240,
    source: 'lamha-store-performance',
    returnTo: resultSetUrl,
  });
  const detail = new URL(detailUrl, ORIGIN);
  const restoredResultSet = new URL(detail.searchParams.get('returnTo'), ORIGIN);
  assert.equal(restoredResultSet.searchParams.get('performanceFilter'), 'never_shipped');
  assert.equal(restoredResultSet.searchParams.get('returnTo'), reportUrl);
});

test('RLA-04: the restored result set deterministically returns to the original report', () => {
  const restored = new URL(withNeverShipped(salesUrl), ORIGIN);
  const parent = reportReturnPath(
    restored.searchParams.get('source'),
    restored.searchParams.get('returnTo'),
  );
  assert.equal(parent, reportUrl);

  const report = new URL(parent, ORIGIN);
  assert.equal(report.searchParams.get('dateFrom'), '2026-08-01');
  assert.equal(report.searchParams.get('dateTo'), '2026-09-04');
  assert.equal(report.searchParams.get('domain'), 'sales');
});

test('RLA-04: unknown report query parameters survive every nested return', () => {
  const restored = new URL(withNeverShipped(salesUrl), ORIGIN);
  const parent = reportReturnPath(restored.searchParams.get('source'), restored.searchParams.get('returnTo'));
  const report = new URL(parent, ORIGIN);
  assert.equal(report.searchParams.get('custom'), 'keep-me');
});

test('RLA-04: a direct Sales deep link consumes the shared report-return contract after remount', async () => {
  const remounted = new URL(salesUrl, ORIGIN);
  assert.equal(reportReturnPath(remounted.searchParams.get('source'), remounted.searchParams.get('returnTo')), reportUrl);

  const [salesHub, performance] = await Promise.all([
    source('src/pages/SalesHub.jsx'),
    source('src/components/LamhaStorePerformance.jsx'),
  ]);

  assert.match(salesHub, /import \{ reportReturnPath \} from '\.\.\/lib\/workspaceJourneyNavigation\.js'/);
  assert.match(salesHub, /reportReturnPath\(routeParams\.get\('source'\), routeParams\.get\('returnTo'\)\)/);
  assert.match(salesHub, /العودة إلى التقرير/);
  assert.match(salesHub, /navigate\(reportReturnTo\)/);
  assert.match(performance, /const params = new URLSearchParams\(location\.search\)/);
  assert.match(performance, /returnTo: `\$\{location\.pathname\}\$\{location\.search\}`/);
});
