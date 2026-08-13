import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260813160000_prevent_ambiguous_merchant_autolinks.sql', import.meta.url),
  'utf8',
);

test('merchant auto-link rejects equal or near-equal store candidates', () => {
  assert.match(migration, /runner_up_confidence/);
  assert.match(migration, /confidence - runner_up_confidence >= 0\.05/);
  assert.match(migration, /group by customer_name, store_id/);
});

test('verified same-name stores remain pinned by explicit store id', () => {
  assert.match(migration, /store_id = '1961'/);
  assert.match(migration, /store_id = '654'/);
  assert.match(migration, /match_method = 'manual'/);
});
