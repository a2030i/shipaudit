import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL(
  '../supabase/migrations/20260815175022_exclude_opening_balances_from_zatca_dashboard.sql',
  import.meta.url,
);

test('homepage ZATCA counter excludes opening balances before building every metric', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.match(migration, /eligible\s+as\s*\([\s\S]*invoice_number[\s\S]*الرصيد الافتتاحي/);
  assert.match(migration, /pending\s+as\s*\([\s\S]*from eligible[\s\S]*yet_to_be_pushed/);
  assert.match(migration, /verify\s+as\s*\([\s\S]*from eligible/);
  assert.match(migration, /'invoices'[\s\S]*from pending/);
});
