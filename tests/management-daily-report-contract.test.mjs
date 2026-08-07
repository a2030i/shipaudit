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

test('management report separates raw cold inventory from actionable unassigned leads', () => {
  assert.match(migration, /lead_kind\s*=\s*'inbound'/);
  assert.match(migration, /as unassigned_leads/);
  assert.match(migration, /lead_kind\s*=\s*'cold'/);
  assert.match(migration, /as cold_lead_pool/);
});

test('management worker advances its next run after a successful report', () => {
  assert.match(worker, /nextRun\.setUTCHours\(7,0,0,0\)/);
  assert.match(worker, /next_run_at:nextRun\.toISOString\(\)/);
});
