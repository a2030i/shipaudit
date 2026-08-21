import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/pages/Reconciliation.jsx', import.meta.url), 'utf8');

function between(start, end) {
  const from = page.indexOf(start);
  const to = page.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source section: ${start}`);
  return page.slice(from, to);
}

test('opening and refreshing reconciliation never invokes an automatic linker', () => {
  const refresh = between('const refresh = useCallback', '// Picker confirms');
  assert.doesNotMatch(refresh, /autolinkBalancesByExactName|linkUnmatchedToStore|linkInternalRowToZohoRow/);
  assert.match(refresh, /loadReconciliation/);
  assert.match(refresh, /loadUnmatchedBalances/);
});

test('opening or rereading Daftra comparison is read-only', () => {
  const open = between('const openDaftraBalances', '// This is intentionally separate');
  assert.match(open, /loadDaftraClosingBalances/);
  assert.doesNotMatch(open, /syncZohoOpeningBalances|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
});

test('external sync and link writes remain explicit reviewed actions', () => {
  assert.match(page, /const syncDaftraOpeningBalances/);
  assert.match(page, /onClick=\{onSyncOpening\}/);
  assert.match(page, /setLinkTarget\(\{ rawName: u\.rawName/);
  assert.match(page, /MerchantPickerModal/);
  assert.match(page, /onSubmit=\{\(e\) => \{ e\.preventDefault\(\); if \(picked\) onConfirm\(picked\); \}\}/);
  assert.match(page, /الربط لا يتم تلقائيًا/);
});
