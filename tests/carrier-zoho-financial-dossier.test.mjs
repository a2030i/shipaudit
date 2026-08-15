import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20260815184842_carrier_zoho_financial_dossier.sql', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/lib/carrierProfileService.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/pages/CarrierProfile.jsx', import.meta.url), 'utf8');

test('ربط مورد Zoho صريح وفريد لكل شركة مع حماية الصلاحيات', () => {
  assert.match(migration, /create table if not exists public\.carrier_zoho_vendor_links/);
  assert.match(migration, /zoho_vendor_id text not null unique/);
  assert.match(migration, /crm_has_permission\('zoho\.configure'\)/);
  assert.match(migration, /treasury_already_linked/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /set_carrier_zoho_financial_links[\s\S]*security definer/);
  assert.match(migration, /carrier_zoho_financial_dossier\(p_carrier_id text\)[\s\S]*security invoker/);
});

test('الملف المالي يجمع المورد والفواتير والمدفوعات وCOD والخزينة', () => {
  assert.match(migration, /carrier_zoho_financial_dossier/);
  for (const key of ['vendor', 'bills', 'payments', 'vendor_credits', 'cod', 'treasuries', 'recent_activity']) {
    assert.match(migration, new RegExp(`'${key}'`));
  }
  assert.match(service, /carrier_zoho_financial_dossier/);
  assert.match(service, /Promise\.all/);
});

test('ملف شركة الشحن يتيح الربط ويعرض مصادر الأرقام بوضوح', () => {
  assert.match(page, /الملف المالي الموحّد/);
  assert.match(page, /مورد Zoho/);
  assert.match(page, /خزينة COD في شجرة الحسابات/);
  assert.match(page, /COD معلّق تشغيليًا/);
  assert.match(page, /فرق COD عن الخزينة/);
  assert.match(page, /can\('zoho\.configure'\)/);
});
