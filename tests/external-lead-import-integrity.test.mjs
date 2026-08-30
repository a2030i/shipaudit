import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const service = fs.readFileSync(new URL('../src/lib/crmLeadsService.js', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('../src/pages/CrmWorkspace.jsx', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260830061439_clean_external_leads_by_phone.sql', import.meta.url), 'utf8');

test('رفع الملفات يعتبر رقم الجوال هو هوية الجمهور الوحيدة', () => {
  assert.match(service, /existingPhones\.has\(r\.phoneNormalized\)/);
  assert.match(service, /batchSeen\.has\(r\.phoneNormalized\)/);
  assert.doesNotMatch(service, /const identity = `\$\{r\.phoneNormalized\}\|/);
  assert.match(service, /skippedDuplicatePhone: skippedExact/);
  assert.match(service, /error\.code !== '23505'/);
  assert.match(service, /تعذر إكمال الرفع بسبب تزامن ملف آخر/);
});

test('رفع الملفات يستبعد عملاء أحدث دليل لمحة', () => {
  assert.match(service, /await loadLatestMerchants\(\)/);
  assert.match(service, /if \(r\.matchedStore\) \{ skippedExisting\+\+; continue; \}/);
  assert.match(workspace, /عميل لمحة:/);
});

test('قاعدة البيانات تؤرشف التنظيف وتمنع تكرار رقم ملف مستقبلاً', () => {
  assert.match(migration, /crm_lead_cleanup_archive/);
  assert.match(migration, /'lamha_customer'/);
  assert.match(migration, /'duplicate_phone'/);
  assert.match(migration, /create unique index if not exists ux_crm_file_leads_phone/i);
  assert.match(migration, /crm_remove_leads_for_new_lamha_merchants/);
  assert.match(migration, /alter table public\.crm_lead_cleanup_archive enable row level security/i);
});
