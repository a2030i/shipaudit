import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Zoho payment details are refreshed only when changed or stale', async () => {
  const sync = await read('supabase/functions/zoho-sync/index.ts');
  const webhook = await read('supabase/functions/zoho-webhook/index.ts');

  assert.match(sync, /PAYMENT_UNUSED_RECHECK_MS\s*=\s*6\s*\*\s*60\s*\*\s*60_000/);
  assert.match(sync, /unused_checked_at\.is\.null,unused_checked_at\.lt\./);
  assert.match(sync, /unused_checked_at:\s*new Date\(\)\.toISOString\(\)/);
  assert.match(sync, /unused_checked_at:\s*null/);
  assert.match(webhook, /unused_checked_at:\s*null/);
});

test('low-volatility Zoho mirrors use staggered refresh intervals', async () => {
  const sync = await read('supabase/functions/zoho-sync/index.ts');

  assert.match(sync, /ent:\s*'bills'[\s\S]*?minIntervalMinutes:\s*120/);
  assert.match(sync, /ent:\s*'vendorpayments'[\s\S]*?minIntervalMinutes:\s*120/);
  assert.match(sync, /ent:\s*'journals'[\s\S]*?minIntervalMinutes:\s*120/);
  assert.match(sync, /ent:\s*'bankaccounts'[\s\S]*?minIntervalMinutes:\s*60/);
});

test('migration adds payment verification stamp and slows VAT snapshots', async () => {
  const migration = await read(
    'supabase/migrations/20260814110000_optimize_zoho_mirror_refresh.sql',
  );

  assert.match(migration, /add column if not exists unused_checked_at timestamptz/);
  assert.match(migration, /zoho_payments_unused_recheck_idx/);
  assert.match(migration, /zoho-vat-refresh/);
  assert.match(migration, /17 \*\/6 \* \* \*/);
});
