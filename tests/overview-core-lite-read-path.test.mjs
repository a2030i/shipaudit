import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../supabase/migrations/20260821213856_overview_core_lite.sql', import.meta.url), 'utf8');

test('overview core lite is additive, read-only and permission guarded', () => {
  assert.match(sql, /create or replace function public\.overview_core_lite/);
  assert.match(sql, /stable\s+security invoker/i);
  assert.match(sql, /crm_has_permission\('overview\.view'\)/);
  assert.match(sql, /revoke all on function public\.overview_core_lite\(text\) from public, anon/);
  assert.match(sql, /grant execute on function public\.overview_core_lite\(text\) to authenticated, service_role/);
  assert.doesNotMatch(sql, /\b(insert|update|delete|merge|truncate)\b\s+(into|public\.|from)/i);
  assert.doesNotMatch(sql, /http|net\.|functions\.invoke|dblink/i);
});

test('overview core lite returns first-screen aggregates rather than detail collections', () => {
  assert.match(sql, /'financial',v_financial/);
  assert.match(sql, /'vat',v_vat/);
  assert.match(sql, /'actions',v_actions/);
  assert.match(sql, /'closeReadiness',v_close/);
  assert.match(sql, /'sources',v_sources/);
  assert.doesNotMatch(sql, /'customers'\s*,/);
  assert.doesNotMatch(sql, /'merchant(s)?'\s*,\s*coalesce\s*\(\s*\(select jsonb_agg/i);
  assert.doesNotMatch(sql, /'auditShipments'|'lamhaShipments'|'events'\s*,\s*coalesce\s*\(\s*\(select jsonb_agg/i);
});

test('overview core lite preserves the current receivables bucket boundaries', () => {
  assert.match(sql, /age_days between 0 and 15/);
  assert.match(sql, /age_days between 16 and 30/);
  assert.match(sql, /age_days between 31 and 60/);
  assert.match(sql, /age_days between 61 and 90/);
  assert.match(sql, /age_days > 90/);
  assert.match(sql, /line_kind='opening_balance'/);
  assert.match(sql, /greatest\(b90p-opening_balance,0\)/);
});
