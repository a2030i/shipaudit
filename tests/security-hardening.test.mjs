import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('assistant requires a real user and a dedicated permission', async () => {
  const source = await read('supabase/functions/assistant/index.ts');
  assert.match(source, /auth\.getUser\(\)/);
  assert.match(source, /system\.ai_assistant/);
  assert.match(source, /REPORT_SQL/);
  assert.doesNotMatch(source, /payload\?\.model/);
  assert.doesNotMatch(source, /args\.query/);
});

test('database migration prevents profile self-escalation', async () => {
  const sql = await read('supabase/migrations/20260803170000_employee_data_leakage_hardening.sql');
  assert.match(sql, /guard_profile_authorization_fields/);
  assert.match(sql, /new\.role is distinct from old\.role/);
  assert.match(sql, /new\.permissions is distinct from old\.permissions/);
  assert.match(sql, /revoke all on function public\.assistant_readonly_sql\(text\) from public, anon, authenticated/);
});

test('private storage policies require action permissions', async () => {
  const sql = await read('supabase/migrations/20260803170000_employee_data_leakage_hardening.sql');
  for (const policy of [
    'carrier_statements_storage_read',
    'webhook_uploads_read',
    'weight_billing_read',
    'ivr_audio_read',
    'task_files_read',
  ]) assert.match(sql, new RegExp(`create policy ${policy}`));
  assert.doesNotMatch(sql, /bucket_id = ANY .* USING \(true\)/);
});

test('audit source evidence is private and action-gated', async () => {
  const sql = await read('supabase/migrations/20260805090000_audit_source_evidence.sql');
  assert.match(sql, /'audit-source-files'.*false/s);
  assert.match(sql, /crm_has_permission\('audits\.view'\)/);
  assert.match(sql, /crm_has_permission\('audits\.create'\)/);
  assert.match(sql, /crm_has_permission\('audits\.delete'\)/);
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(sql, /with check\s*\(\s*true\s*\)/i);
});

test('legacy operational policies are replaced with action permissions', async () => {
  const sql = await read('supabase/migrations/20260803172000_complete_employee_action_rls.sql');
  assert.match(sql, /crm\.manage_deals/);
  assert.match(sql, /campaigns\.send/);
  assert.match(sql, /internal_exports\.pull/);
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(sql, /with check\s*\(\s*true\s*\)/i);
});

test('employee report RPCs and public views obey caller RLS', async () => {
  const sql = await read('supabase/migrations/20260803173000_secure_rpc_views_for_employees.sql');
  assert.match(sql, /security_invoker = true/);
  assert.match(sql, /customer_money_dashboard/);
  assert.match(sql, /alter function %s security invoker/);
  assert.match(sql, /revoke execute on function %s from public, anon, authenticated/);
});

test('derived views enforce their own feature permissions', async () => {
  const sql = await read('supabase/migrations/20260803174000_guard_derived_views_by_permission.sql');
  assert.match(sql, /customer_ar/);
  assert.match(sql, /receivables\.view/);
  assert.match(sql, /v_crm_retargeting/);
  assert.match(sql, /app_has_any_permission/);
});

test('remaining database functions pin their search path', async () => {
  const sql = await read('supabase/migrations/20260803175000_pin_remaining_function_search_paths.sql');
  assert.match(sql, /_test_alloc_guard\(\) set search_path = public, pg_temp/);
  assert.match(sql, /canon_lead_category\(text\) set search_path = public, pg_temp/);
});

test('browser persistence strips third-party secrets and logout clears caches', async () => {
  const [settings, auth] = await Promise.all([
    read('src/data/carriers.js'),
    read('src/lib/auth.jsx'),
  ]);
  assert.match(settings, /delete parsed\.openrouterKey/);
  assert.match(settings, /_discardedSecret/);
  assert.match(auth, /clearSensitiveBrowserState\(\)/);
  assert.match(auth, /localStorage\.removeItem\('shipaudit_settings_v1'\)/);
});

test('bulk backup export is gated and browser headers are present', async () => {
  const [settings, vercel, vite] = await Promise.all([
    read('src/pages/Settings.jsx'),
    read('vercel.json'),
    read('vite.config.js'),
  ]);
  assert.match(settings, /can\('reports\.export'\)/);
  assert.match(vercel, /Content-Security-Policy/);
  assert.match(vercel, /X-Content-Type-Options/);
  assert.match(vite, /base:\s*'\/'/);
});

test('spreadsheet parser is pinned to patched SheetJS release', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.match(pkg.dependencies.xlsx, /xlsx-0\.20\.3/);
});
