import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20260807130000_scope_management_unassigned_leads.sql', import.meta.url),
  'utf8',
);
const worker = await readFile(
  new URL('../supabase/functions/work-agent-management-report/index.ts', import.meta.url),
  'utf8',
);
const zatcaMigration = await readFile(
  new URL('../supabase/migrations/20260807131500_use_live_zatca_agent_in_management_report.sql', import.meta.url),
  'utf8',
);

test('management report separates raw cold inventory from actionable unassigned leads', () => {
  assert.match(migration, /lead_kind\s*=\s*'inbound'/);
  assert.match(migration, /as unassigned_leads/);
  assert.match(migration, /lead_kind\s*=\s*'cold'/);
  assert.match(migration, /as cold_lead_pool/);
});

test('management worker advances to the next 12-hour slot after a successful report', () => {
  assert.match(worker, /utcHour<6/);
  assert.match(worker, /nextRun\.setUTCHours\(6,0,0,0\)/);
  assert.match(worker, /nextRun\.setUTCHours\(18,0,0,0\)/);
  assert.match(worker, /next_run_at:nextRun\.toISOString\(\)/);
});

test('management report uses the live nightly ZATCA result, not the invoice-list mirror', () => {
  assert.match(zatcaMigration, /agent\.agent_key\s*=\s*'zatca_nightly'/);
  assert.match(zatcaMigration, /run\.details->>'failed'/);
  assert.doesNotMatch(zatcaMigration, /einvoice_status\s*=\s*'yet_to_be_pushed'/);
});
