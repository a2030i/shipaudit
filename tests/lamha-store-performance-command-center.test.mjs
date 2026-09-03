import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../supabase/migrations/20260829215247_lamha_store_performance_command_center.sql', import.meta.url);

const migrationChain = [
  '../supabase/migrations/20260829215247_lamha_store_performance_command_center.sql',
  '../supabase/migrations/20260829215359_lamha_store_performance_require_midnight.sql',
  '../supabase/migrations/20260829215712_lamha_store_performance_recent_first.sql',
];

test('Lamha performance migration history matches the three production receipts', async () => {
  const migrations = await Promise.all(migrationChain.map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  assert.match(migrations[0], /create or replace function public\.lamha_store_performance_command_center/);
  assert.match(migrations[1], /to_regprocedure\('public\.lamha_store_performance_command_center/);
  assert.match(migrations[2], /order keeps recent operational activity first/);
});

test('Lamha daily performance uses one canonical scheduled Riyadh snapshot per day', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /at time zone 'Asia\/Riyadh'/);
  assert.match(sql, /partition by source\.local_date/);
  assert.match(sql, /least\(source\.local_second, 86400 - source\.local_second\)/);
  assert.match(sql, /lamha_employee_api_export_scheduled/);
  assert.match(sql, /lamha_employee_api_export_manual/);
});

test('Lamha shipment deltas quarantine counter regressions and never subtract them', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /greatest\([\s\S]*coalesce\(current_store\.shipment_count, 0\) - coalesce\(previous_store\.shipment_count, 0\)/);
  assert.match(sql, /least\([\s\S]*negative_shipment_delta/);
  assert.match(sql, /counter_exceptions/);
  assert.match(sql, /when previous_meta\.snapshot_id is null then 0/);
});

test('Lamha account state and shipping activity remain separate dimensions', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /in \('inactive', 'غير نشط'\) then 'disabled'/);
  assert.match(sql, /else 'enabled'/);
  assert.match(sql, /end as account_state/);
  assert.match(sql, /end as activity_state/);
  assert.match(sql, /'account_enabled'/);
  assert.match(sql, /'dormant_30'/);
});

test('registration and first observation are explicitly different events', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /created_at_platform at time zone 'Asia\/Riyadh'/);
  assert.match(sql, /as registered_today/);
  assert.match(sql, /newly_observed as observed_today/);
});

test('performance UI drills every signal into the same dense result set', async () => {
  const [component, service] = await Promise.all([
    readFile(new URL('../src/components/LamhaStorePerformance.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/retargetingService.js', import.meta.url), 'utf8'),
  ]);
  assert.match(component, /chooseFilter\('shipped_today'\)/);
  assert.match(component, /chooseFilter\('disabled_today'\)/);
  assert.match(component, /buildStore360Url/);
  assert.match(component, /lamha-result-set/);
  assert.match(component, /performanceFilter/);
  assert.match(component, /returnTo: `\$\{location\.pathname\}\$\{location\.search\}`/);
  assert.match(service, /lamha_store_performance_command_center/);
  assert.match(service, /p_offset: Math\.max\(0, page\) \* limit/);
});
