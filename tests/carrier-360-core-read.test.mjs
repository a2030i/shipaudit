import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Carrier 360 core is additive, local, read-only and permission-scoped', async () => {
  const sql = await read('supabase/migrations/20260821213000_carrier_360_core_read_path.sql');
  assert.match(sql, /create or replace function public\.carrier_360_core\(p_carrier_id text\)/i);
  assert.match(sql, /stable\s+security invoker/i);
  assert.match(sql, /auth\.uid\(\) is null/i);
  for (const permission of ['audits.view', 'cod.view', 'webhook.view', 'zoho.view']) {
    assert.match(sql, new RegExp(permission.replace('.', '\\.')));
  }
  for (const source of ['carrier_operations', 'cod_settlement', 'audits', 'audit_claims', 'webhook_events']) {
    assert.match(sql, new RegExp(`public\\.${source}`));
  }
  assert.doesNotMatch(sql, /\b(insert|update|delete|merge)\s+(into|public\.)/i);
  assert.match(sql, /revoke all on function public\.carrier_360_core\(text\) from public, anon/i);
});

test('Carrier 360 core consumes persisted audit difference without recomputing audit rules', async () => {
  const sql = await read('supabase/migrations/20260821213000_carrier_360_core_read_path.sql');
  assert.match(sql, /sum\(diff\)/i);
  assert.match(sql, /sum\(greatest\(coalesce\(diff,0\),0\)\)/i);
  assert.doesNotMatch(sql, /expected_total\s*-\s*invoiced_total|weight_kg\s*\*/i);
});

test('Carrier 360 opens through one core request and retains an immediate legacy fallback', async () => {
  const service = await read('src/lib/carrierProfileService.js');
  const page = await read('src/pages/CarrierProfile.jsx');
  assert.match(service, /client\.rpc\('carrier_360_core'/);
  assert.match(service, /VITE_CARRIER_360_READ_MODE \|\| 'core'/);
  assert.match(service, /core unavailable; using legacy fallback/);
  assert.match(page, /loadCarrierProfileRead\(carrierId\)/);
});

test('invoice details use server pagination and preserve URL context', async () => {
  const service = await read('src/lib/carrierProfileService.js');
  const page = await read('src/pages/CarrierProfile.jsx');
  assert.match(service, /client\.rpc\('carrier_360_audits_page'/);
  assert.match(service, /p_page_size: safeSize/);
  assert.match(page, /\["needs_action","تحتاج مراجعة"\]/);
  assert.match(page, /searchParams\.get\('carrier'\) \|\| searchParams\.get\('id'\)/);
  assert.match(page, /searchParams\.get\('audit'\) \|\| searchParams\.get\('invoice'\)/);
  assert.match(page, /searchParams\.get\('filter'\)/);
  assert.match(page, /searchParams\.get\('page'\)/);
  assert.match(page, /searchParams\.get\('returnTo'\)/);
});

test('shipment detail is paginated without a hidden browser cap', async () => {
  const sql = await read('supabase/migrations/20260821224500_carrier_360_audit_shipments_page.sql');
  const core = await read('src/lib/coreService.js');
  const page = await read('src/pages/CarrierProfile.jsx');
  assert.match(sql, /security invoker/i);
  assert.match(sql, /jsonb_array_elements/i);
  assert.match(sql, /public\.audit_shipments/i);
  assert.doesNotMatch(sql, /\b(insert|update|delete|merge)\s+(into|public\.)/i);
  assert.match(core, /client|supabase\.rpc\('carrier_360_audit_shipments_page'/);
  assert.match(page, /loadCarrierAuditShipmentsPage\(carrier\.id, selectedAuditId/);
  assert.match(page, /pageSize = 100/);
  assert.doesNotMatch(page, /groups\.flat\(\)\.slice\(0, 500\)/);
  assert.match(page, /searchParams\.get\('audit'\) \|\| searchParams\.get\('invoice'\)/);
});
