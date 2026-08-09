import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const edge = readFileSync('supabase/functions/daftra-opening-balances/index.ts', 'utf8');
const service = readFileSync('src/lib/daftraService.js', 'utf8');
const page = readFileSync('src/pages/Reconciliation.jsx', 'utf8');
const migration = readFileSync('supabase/migrations/20260809124500_daftra_client_balance_snapshots.sql', 'utf8');

test('historical Daftra reconciliation reads an immutable period snapshot', () => {
  assert.match(edge, /action === 'list_period_closing_balances'/);
  assert.match(edge, /daftra_client_balance_snapshots/);
  assert.match(edge, /official_daftra_clients_balance_report_closing_balance/);
  assert.match(edge, /filter\(row => Math\.abs\(row\.closing_balance\) > 0\.005\)/);
});

test('frontend requests the fixed January closing period and exports full audit columns', () => {
  assert.match(service, /periodStart = '2026-01-01'/);
  assert.match(service, /periodEnd = '2026-01-31'/);
  assert.match(service, /action: 'list_period_closing_balances'/);
  assert.match(page, /إقفال دفتره × افتتاحي زوهو/);
  assert.match(page, /إقفال دفتره 31 يناير/);
  assert.match(page, /مبيعات يناير/);
  assert.match(page, /دفعات يناير/);
  assert.match(page, /المستحق للتحصيل/);
  assert.match(page, /أرصدة لصالح العملاء/);
  assert.match(page, /لا تُخصم من إجمالي التحصيل/);
  assert.match(page, /مستحق للتحصيل' : 'رصيد لصالح العميل/);
  assert.match(page, /مطابقة_إقفال_دفترة_مع_افتتاحي_زوهو_حتى_2026-01-31\.xlsx/);
});

test('snapshot is read-only for authenticated users and keeps the full accounting roll-forward', () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /crm_has_permission\('reconciliation\.view'\)/);
  assert.match(migration, /revoke insert, update, delete, truncate/);
  for (const column of [
    'opening_balance', 'total_sales', 'total_returns', 'net_sales',
    'total_payments', 'settlements', 'closing_balance',
  ]) assert.match(migration, new RegExp(column));
});
