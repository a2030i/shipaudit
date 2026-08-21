import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const service = fs.readFileSync(new URL('../src/lib/overviewService.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../src/pages/Overview.jsx', import.meta.url), 'utf8');
const sql = fs.readFileSync(new URL('../supabase/migrations/20260821210653_overview_core_read_path.sql', import.meta.url), 'utf8');

test('overview stays on legacy until its explicit feature flag is enabled', () => {
  assert.match(service, /VITE_OVERVIEW_READ_MODE \|\| 'legacy'/);
  assert.match(service, /core unavailable; using legacy fallback/);
  assert.match(page, /loadOverviewRead\(\{ period, topN: 5 \}\)/);
});

test('overview core is local, additive, invoker-safe and permission scoped', () => {
  assert.match(sql, /create or replace function public\.overview_core/);
  assert.match(sql, /security invoker/);
  assert.match(sql, /crm_has_permission\('overview\.view'/);
  assert.match(sql, /revoke all on function public\.overview_core/);
  assert.match(sql, /grant execute on function public\.overview_core[^;]+to authenticated/);
  assert.doesNotMatch(sql, /https?:\/\//i);
  assert.doesNotMatch(sql, /insert\s+into|update\s+public\.|delete\s+from/i);
});

test('oversized accounting facts cannot cut over without passing the feature gate', () => {
  assert.match(sql, /accountingCycleRaw/);
  assert.match(service, /VITE_OVERVIEW_READ_MODE \|\| 'legacy'/);
  assert.match(service, /readPath: 'overview_core'/);
});
