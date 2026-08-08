import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('manual Zoho bank hand-off is tracked and verified without statement writes', async () => {
  const [edge, migration, service, page] = await Promise.all([
    read('supabase/functions/zoho-operations/index.ts'),
    read('supabase/migrations/20260808135740_zoho_bank_export_verification.sql'),
    read('src/lib/pnlService.js'),
    read('src/pages/ZohoData.jsx'),
  ]);

  assert.match(edge, /bank_export_record:\s*'zoho\.bank_import'/);
  assert.match(edge, /bank_export_verify:\s*'zoho\.bank_import'/);
  assert.match(edge, /zoho_bank_export_batches/);
  assert.match(edge, /zoho_bank_export_items/);
  assert.match(edge, /bank_import_disabled_manual_zoho_upload/);
  assert.doesNotMatch(edge, /books\/v3\/bankstatements[^'`]*[`'][^\n]*method:\s*'POST'/);

  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /idempotency_key text not null unique/i);
  assert.match(migration, /app_has_any_permission\(array\['bank\.view','zoho\.bank_import'\]\)/);

  assert.match(service, /recordZohoBankExport/);
  assert.match(service, /verifyZohoBankExport/);
  assert.match(page, /فحص الفرق مع زوهو/);
  assert.match(page, /تحقق بعد الرفع في زوهو/);
  assert.match(page, /تنزيل الناقص ورفعه/);
});

test('bank export verification remains scoped to one linked bank account', async () => {
  const edge = await read('supabase/functions/zoho-operations/index.ts');
  assert.match(edge, /\.eq\('bank', link\.internal_bank_name\)\.in\('id'/);
  assert.match(edge, /\.eq\('zoho_account_id', accountId\)/);
  assert.match(edge, /bank_export_scope_mismatch/);
  assert.match(edge, /zoho_bank_account_id: accountId/);
});
