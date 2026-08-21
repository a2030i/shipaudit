import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20260821040618_security_foundation_authorization_hardening.sql');

test('self-service role escalation and generic money writes fail closed', () => {
  assert.match(migration, /drop policy if exists profiles_update_own/i);
  assert.match(migration, /drop policy if exists profiles_update on public\.profiles/i);
  assert.match(migration, /drop policy if exists profiles_admin_update on public\.profiles/i);
  assert.match(migration, /create policy profiles_admin_update[\s\S]*?using \(\(select public\.is_admin\(\)\)\)[\s\S]*?with check \(\(select public\.is_admin\(\)\)\)/i);
  assert.match(migration, /create or replace function public\.has_money_write\(\)[\s\S]*?select false/i);
  assert.doesNotMatch(migration, /create policy[^;]+has_money_write/i);
  assert.match(migration, /drop policy if exists p_payments_write on public\.payments/i);
  assert.match(migration, /drop policy if exists audit_shipments_all on public\.audit_shipments/i);
  assert.match(migration, /drop policy if exists bdw_all on public\.bad_debt_writeoffs/i);
  assert.match(migration, /drop policy if exists p_cod_settlement_write on public\.cod_settlement/i);
  assert.match(migration, /payments_insert[\s\S]*?payments\.create/i);
  assert.match(migration, /payment_allocations_insert[\s\S]*?payments\.allocate/i);
  assert.match(migration, /period_closes_insert[\s\S]*?system\.period_close/i);
});

test('retargeting SECURITY DEFINER functions enforce feature permissions', () => {
  assert.match(migration, /set_retargeting_followup[\s\S]*?app_has_any_permission\(array\['sales\.manage'\]\)/i);
  assert.match(migration, /set_retargeting_followups_bulk[\s\S]*?app_has_any_permission\(array\['sales\.manage'\]\)/i);
  assert.match(migration, /crm_retargeting_leads[\s\S]*?app_has_any_permission\(array\['sales\.view','sales\.manage'\]\)/i);
  assert.match(migration, /sales_today_routed[\s\S]*?app_has_any_permission\(array\['sales\.view','sales\.manage'\]\)/i);
  assert.match(migration, /revoke execute on function public\.sales_today\(uuid\) from authenticated/i);
});

test('PII-bearing select policies require explicit permissions or ownership', () => {
  assert.match(migration, /retargeting_followups_read[\s\S]*?sales\.view/i);
  assert.match(migration, /cq_select[\s\S]*?created_by = \(select auth\.uid\(\)\)[\s\S]*?campaigns\.send/i);
  assert.match(migration, /cq_insert[\s\S]*?campaigns\.send/i);
  assert.match(migration, /ivr_queue_insert[\s\S]*?campaigns\.ivr/i);
  assert.match(migration, /hcs_read[\s\S]*?hatif\.contacts\.sync/i);
  assert.match(migration, /hct_read[\s\S]*?hatif\.workspace\.manage/i);
});

test('Hatif external mutations require dedicated write permissions', () => {
  const contacts = read('supabase/functions/hatif-contacts-sync/index.ts');
  const names = read('supabase/functions/hatif-lead-names/index.ts');
  const catalog = read('src/lib/permissions.js');
  assert.match(catalog, /hatif\.contacts\.sync/);
  assert.match(catalog, /hatif\.workspace\.manage/);
  assert.match(contacts, /workspaceMutation \? canWorkspaceManage/);
  assert.match(contacts, /: canContactSync/);
  assert.match(names, /permissions\?\.\['hatif\.contacts\.sync'\]/);
  assert.doesNotMatch(names, /permissions\?\.\['crm\.view'\]/);
});

test('diagnostic Lamha proxy is retired and Hudhud fails closed', () => {
  const lamha = read('supabase/functions/lamha-sync/index.ts');
  const hudhud = read('supabase/functions/hudhud-short-address/index.ts');
  assert.match(lamha, /status: 410/);
  assert.doesNotMatch(lamha, /fetch\(`\$\{BASE\}\$\{path\}`/);
  assert.match(hudhud, /if\(eventId===null\)return out\(req,[\s\S]*?,503\)/);
});

test('the database is ready for idempotent IVR callback retries', () => {
  assert.match(migration, /unique index if not exists ivr_queue_one_retry_per_call_attempt/i);
});
