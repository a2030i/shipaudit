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
  const sql = await read('supabase/migrations/20260805111318_audit_source_evidence.sql');
  assert.match(sql, /'audit-source-files'.*false/s);
  assert.match(sql, /crm_has_permission\('audits\.view'\)/);
  assert.match(sql, /crm_has_permission\('audits\.create'\)/);
  assert.match(sql, /crm_has_permission\('audits\.delete'\)/);
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(sql, /with check\s*\(\s*true\s*\)/i);
});

test('cross-audit duplicate lookup batches large carrier invoices', async () => {
  const source = await read('src/lib/coreService.js');
  assert.match(source, /const batchSize = 180/);
  assert.match(source, /uniqueAwbs\.slice\(start, start \+ batchSize\)/);
  assert.doesNotMatch(source, /\.in\('awb', awbs\)/);
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

test('combined ZATCA action requires both permissions and live verification', async () => {
  const source = await read('supabase/functions/zoho-operations/index.ts');
  assert.match(source, /invoice_finalize_and_push_zatca/);
  assert.match(source, /\['zoho\.invoice_mark_sent', 'zoho\.invoice_push_zatca'\]/);
  assert.match(source, /getLiveInvoice/);
  assert.match(source, /openingBalance\(inv\.invoice_number\)/);
  assert.match(source, /mark_sent:\$\{inv\.zoho_id\}/);
  assert.match(source, /zatca_push:\$\{inv\.zoho_id\}/);
  assert.ok(
    source.indexOf('const pushKey = `zatca_push:') < source.indexOf('const markKey = `mark_sent:'),
    'Saudi e-invoice flow must push to Fatoora before marking the document sent',
  );
  assert.match(source, /after_zatca_push:\s*true/);
  assert.match(source, /\[41051, -1, 503\]\.includes\(Number\(body\?\.code\)\)/);
  assert.match(source, /retryPortal:\s*true, timeoutMs:\s*15_000/);
  assert.match(source, /offset \+= 2/);
});

test('Zoho bank review is bank-scoped, read/write separated, and explicitly confirmed', async () => {
  const [edge, permissions, service, page] = await Promise.all([
    read('supabase/functions/zoho-operations/index.ts'),
    read('src/lib/permissions.js'),
    read('src/lib/pnlService.js'),
    read('src/pages/ZohoData.jsx'),
  ]);
  assert.match(edge, /bank_unreviewed_list:\s*'bank\.view'/);
  assert.match(edge, /bank_match_candidates:\s*'bank\.view'/);
  assert.match(edge, /bank_match_approve:\s*'zoho\.bank_match'/);
  assert.match(edge, /filter_by:\s*'Status\.Uncategorized'/);
  assert.match(edge, /account_id:\s*accountId/);
  assert.match(edge, /requireLiveZohoBank/);
  assert.match(edge, /treasury_is_not_a_bank/);
  assert.match(edge, /unreviewed_transaction_not_found_for_account/);
  assert.match(edge, /transactions_to_be_matched/);
  assert.match(edge, /bank_match:\$\{accountId\}:\$\{transactionId\}/);
  assert.match(permissions, /key:\s*'zoho\.bank_match'/);
  assert.match(service, /action:\s*'bank_match_approve'/);
  assert.match(page, /مراجعة عمليات جميع البنوك/);
  assert.match(page, /تأكيد المطابقة في زوهو/);
  assert.match(page, /can\('zoho\.bank_match'\)/);
  assert.match(page, /!isZohoPaymentGatewayAccount\(row\)/);
});

test('manual Zoho sync reuses a recent successful run to avoid refresh-token rate limits', async () => {
  const source = await read('supabase/functions/zoho-sync/index.ts');
  assert.match(source, /reused_recent_sync:\s*true/);
  assert.match(source, /2 \* 60_000/);
});

test('collection performance is supervisor-gated and aging snapshots are server scheduled', async () => {
  const [sql, service] = await Promise.all([
    read('supabase/migrations/20260807012508_collection_performance_and_aging_cron.sql'),
    read('src/lib/collectionsService.js'),
  ]);
  assert.match(sql, /collection_team_performance/);
  assert.match(sql, /crm_has_permission\('collections\.view_all'\)/);
  assert.match(sql, /security definer\s+set search_path = ''/i);
  assert.match(sql, /join lateral/);
  assert.match(sql, /p\.zoho_id/);
  assert.match(sql, /capture-ar-aging-daily/);
  assert.match(sql, /'50 20 \* \* \*'/);
  assert.match(sql, /revoke all on function public\.capture_ar_aging_snapshot\(\) from public, anon, authenticated/);
  assert.doesNotMatch(service, /rpc\('capture_ar_aging_snapshot'\)/);
});
