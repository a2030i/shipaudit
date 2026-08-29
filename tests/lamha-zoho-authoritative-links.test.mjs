import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260829184628_lamha_zoho_authoritative_links.sql',
  'utf8',
);
const authorityDoc = readFileSync('docs/architecture/lamha-data-authority.md', 'utf8');
const optimization = readFileSync(
  'supabase/migrations/20260829184846_optimize_lamha_zoho_link_refresh.sql',
  'utf8',
);

test('Lamha accountingUrl Zoho contact id is persisted as the authoritative store identity', () => {
  assert.match(migration, /lamha_zoho_contact_id\(p_api_data jsonb\)/);
  assert.match(migration, /\/contacts\/\(\[0-9\]\+\)/);
  assert.match(migration, /create table if not exists public\.lamha_zoho_store_links/);
  assert.match(migration, /store_id text primary key/);
  assert.match(migration, /zoho_contact_id text not null unique/);
  assert.match(migration, /source text not null default 'lamha_api'/);
});

test('authoritative refresh refuses ambiguity and never falls back to name or phone', () => {
  assert.match(migration, /having count\(distinct p\.store_id\) > 1/);
  assert.match(migration, /raise exception 'lamha_zoho_contact_is_not_unique'/);
  assert.doesNotMatch(migration, /normalize_arabic_name/);
  assert.doesNotMatch(migration, /regexp_replace\([^\n]*phone/i);
  assert.match(authorityDoc, /لا يستخدم اسم المتجر أو اسم جهة Zoho أو رقم الجوال كبديل/);
});

test('legacy operational links are corrected, audited, and protected from manual override', () => {
  assert.match(migration, /create table if not exists public\.lamha_zoho_link_audit/);
  assert.match(migration, /'legacy_link_created'/);
  assert.match(migration, /'legacy_store_corrected'/);
  assert.match(migration, /'conflicting_contact_unlinked'/);
  assert.match(migration, /match_method = 'lamha-zoho-id'/);
  assert.match(migration, /store_has_different_lamha_zoho_contact/);
  assert.match(migration, /customer_merchant_links_lamha_authority/);
});

test('every Lamha API profile merge refreshes Zoho identity in the same transaction', () => {
  assert.match(migration, /v_links := public\.refresh_lamha_zoho_store_links\(\)/);
  assert.match(migration, /jsonb_build_object\('merged', v_count, 'zohoLinks', v_links\)/);
  assert.match(authorityDoc, /يعاد تحديثها بعد كل دفعة قائمة أو تفاصيل من لمحة/);
});

test('unchanged live profile reads do not rewrite the entire identity registry', () => {
  assert.match(optimization, /v_refresh_links boolean := false/);
  assert.match(optimization, /current_link\.zoho_contact_id is distinct from/);
  assert.match(optimization, /lamha_zoho_identity_unchanged/);
  assert.match(optimization, /if v_refresh_links then[\s\S]*refresh_lamha_zoho_store_links/);
});
