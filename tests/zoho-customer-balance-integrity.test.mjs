import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20260806180024_zoho_customer_balance_integrity.sql', import.meta.url),
  'utf8',
);
const syncFunction = await readFile(
  new URL('../supabase/functions/zoho-sync/index.ts', import.meta.url),
  'utf8',
);
const creditCoverageMigration = await readFile(
  new URL('../supabase/migrations/20260807123000_customer_balance_credit_coverage.sql', import.meta.url),
  'utf8',
);

test('opening balance is explicit and never inferred from a mirror gap', () => {
  assert.match(migration, /opening_balance_configured numeric/);
  assert.match(migration, /least\([\s\S]*balance_residual[\s\S]*opening_balance_configured/);
  assert.match(migration, /balance_sync_gap/);
  assert.match(migration, /balance_integrity_status/);
});

test('invoice matching uses Zoho customer id with a legacy-name fallback', () => {
  assert.match(migration, /i\.customer_id = c\.zoho_id/);
  assert.match(migration, /i\.customer_id is null and i\.customer_name = c\.contact_name/);
});

test('unreconciled customers cannot reach collection agents', () => {
  assert.match(migration, /where ar\.balance_integrity_status = 'valid'/);
});

test('sync repairs the full invoice history only for integrity candidates', () => {
  assert.match(syncFunction, /\.in\('balance_integrity_status', \['unchecked', 'mismatch'\]\)/);
  assert.match(syncFunction, /customer_id: String\(candidate\.zoho_id\)/);
  assert.match(syncFunction, /openingBalanceConfigured\(detail/);
  assert.match(syncFunction, /staleIds/);
});

test('fully credit-covered Zoho contacts do not block collection integrity', () => {
  assert.match(
    creditCoverageMigration,
    /unused_credits_receivable[\s\S]*>= greatest\(coalesce\(c\.outstanding_receivable/,
  );
  assert.match(creditCoverageMigration, /then 'valid'/);
  assert.match(creditCoverageMigration, /needs_zoho_settlement/);
});
