import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  readReconciliationJourneyContext,
  updateReconciliationJourneySearch,
} from '../src/lib/workspaceJourneyNavigation.js';
import { buildStore360Url } from '../src/lib/store360Navigation.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('RLA-02: the default customer reconciliation URL restores the full result set', () => {
  assert.deepEqual(readReconciliationJourneyContext('?tab=customers'), {
    tab: 'customers', view: 'customer', status: '', search: '', onlyGaps: false,
  });
});

test('RLA-02: selecting mismatch writes its domain status without dropping unrelated context', () => {
  const next = updateReconciliationJourneySearch(
    '?tab=customers&source=release-acceptance&page=2&sort=gap-desc',
    { status: 'needs_investigation' },
  );
  assert.equal(next, 'tab=customers&source=release-acceptance&page=2&sort=gap-desc&status=needs_investigation');
  assert.equal(readReconciliationJourneyContext(`?${next}`).status, 'needs_investigation');
});

test('RLA-02: a direct mismatch deep link deterministically restores its result-set identity', () => {
  const context = readReconciliationJourneyContext('?tab=customers&status=needs_investigation');
  assert.equal(context.tab, 'customers');
  assert.equal(context.status, 'needs_investigation');
});

test('RLA-02: Customer 360 returnTo contains the complete reconciliation URL', () => {
  const search = updateReconciliationJourneySearch('?tab=customers', { status: 'needs_investigation' });
  const returnTo = `/reconciliation?${search}`;
  const detail = buildStore360Url({
    storeId: 66,
    view: 'finance',
    source: 'lamha-zoho-reconciliation',
    returnTo,
  });
  const detailParams = new URL(detail, 'https://shipaudit.local').searchParams;
  assert.equal(detailParams.get('returnTo'), '/reconciliation?tab=customers&status=needs_investigation');
});

test('RLA-02: returning and remounting preserves mismatch plus search and pagination context', () => {
  const search = updateReconciliationJourneySearch(
    '?tab=customers&page=3&source=cross-workspace',
    { status: 'needs_investigation', search: 'تايدي' },
  );
  assert.deepEqual(readReconciliationJourneyContext(`?${search}`), {
    tab: 'customers', view: 'customer', status: 'needs_investigation', search: 'تايدي', onlyGaps: false,
  });
  assert.match(search, /page=3/);
  assert.match(search, /source=cross-workspace/);
});

test('RLA-02: legacy differences links remain readable and canonicalize on the next filter change', () => {
  assert.equal(readReconciliationJourneyContext('?tab=customers&differences=1').status, 'differences');
  const next = updateReconciliationJourneySearch('?tab=customers&differences=1', { status: 'matched' });
  assert.equal(next, 'tab=customers&status=matched');
});

test('RLA-02: back and forward URLs each restore their own result-set state', () => {
  const all = '?tab=customers';
  const mismatch = `?${updateReconciliationJourneySearch(all, { status: 'needs_investigation' })}`;
  assert.equal(readReconciliationJourneyContext(all).status, '');
  assert.equal(readReconciliationJourneyContext(mismatch).status, 'needs_investigation');
  assert.equal(readReconciliationJourneyContext(all).status, '');
});

test('RLA-02: the page derives result-set state from URL and returns the current full location', async () => {
  const page = await read('src/pages/Reconciliation.jsx');
  assert.match(page, /readReconciliationJourneyContext\(location\.search\)/);
  assert.match(page, /updateReconciliationJourneySearch\(location\.search, patch\)/);
  assert.match(page, /returnTo: `\$\{location\.pathname\}\$\{location\.search\}`/);
  assert.doesNotMatch(page, /const \[st, setSt\]\s*=\s*useState/);
});
