import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Zoho bank reconciliation scans full local history and complete paginated Zoho inventory', async () => {
  const [edge, page] = await Promise.all([
    read('supabase/functions/zoho-operations/index.ts'),
    read('src/pages/ZohoData.jsx'),
  ]);

  assert.match(edge, /loadAllLocalBankTransactions/);
  assert.match(edge, /\.range\(from, from \+ LOCAL_BANK_PAGE_SIZE - 1\)/);
  assert.match(edge, /params\.set\('date_start', period\.start\)/);
  assert.match(edge, /params\.set\('date_end', period\.end\)/);
  assert.match(edge, /expandZohoBankTransactionRows/);
  assert.match(edge, /imported_transactions/);
  assert.match(edge, /zohoRowBelongsToAccount/);
  assert.match(edge, /row\?\.from_account_id, row\?\.to_account_id/);
  assert.match(edge, /collected\.filter\(\(row: any\) => zohoRowBelongsToAccount\(row, accountId\)\)/);
  assert.doesNotMatch(edge, /!row\.account_id \|\| String\(row\.account_id\) === accountId/);
  assert.match(edge, /zoho_bank_transactions_incomplete/);
  assert.match(edge, /zoho_bank_unreviewed_incomplete/);
  assert.match(edge, /comparison_mode:\s*'full_history'/);
  assert.match(edge, /history_excluded:\s*0/);
  assert.match(edge, /const liveProofCandidates: any\[\] = \[liveAnchor, unreviewedAnchor\]/);
  assert.match(edge, /imported_statement_is_informational/);
  assert.doesNotMatch(edge, /imported\.has\(String\(t\.id\)\)/);
  assert.doesNotMatch(edge, /\.eq\('action', 'bank_statement_import'\)\.eq\('status', 'succeeded'\)/);
  assert.doesNotMatch(edge, /ordered\.slice\(anchorIndex \+ 1\)/);
  assert.doesNotMatch(edge, /const fresh = afterAnchor\.filter/);

  assert.match(page, /بما فيها الفجوات التاريخية/);
  assert.match(page, /هذه ليست نقطة بداية ولا تستبعد ما قبلها/);
});
