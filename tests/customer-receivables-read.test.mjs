import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const service = fs.readFileSync('src/lib/customerReceivablesRead.js', 'utf8');
const page = fs.readFileSync('src/pages/CustomerMoney.jsx', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260821193000_customer_receivables_work_queue.sql', 'utf8');

test('central receivables read is one paginated RPC with a legacy feature flag', () => {
  assert.match(service, /VITE_RECEIVABLES_READ_MODE/);
  assert.match(service, /client\.rpc\('customer_receivables_work_queue'/);
  assert.match(service, /p_page:/);
  assert.match(service, /p_page_size:/);
  assert.match(page, /RECEIVABLES_READ_MODE !== 'legacy'/);
  assert.match(page, /central path unavailable; using legacy fallback/);
});

test('financial and Store 360 identity never falls back to phone or normalized name', () => {
  assert.match(migration, /join ar_base a on a\.zoho_id::text = l\.contact_id::text/);
  assert.match(migration, /customer_merchant_links/);
  assert.doesNotMatch(migration, /normalize_arabic_name/);
  assert.match(migration, /'phoneUsedForIdentity', false/);
  assert.match(migration, /'nameUsedForFinancialIdentity', false/);
});

test('RPC enforces receivables permission and hides task assignment metadata by section', () => {
  assert.match(migration, /crm_has_permission\('receivables\.view'\)/);
  assert.match(migration, /v_can_tasks := public\.crm_has_permission\('collections\.view'\)/);
  assert.match(migration, /v_can_assign := public\.crm_has_permission\('collections\.assign'\)/);
  assert.match(migration, /case when v_can_tasks and task_id is not null/);
  assert.match(migration, /case when v_can_assign then p\.name else null end assignee_name/);
  assert.match(migration, /revoke all on function public\.customer_receivables_work_queue/);
});

test('all URL work-queue filters are passed to the server and returnTo remains full', () => {
  for (const key of ['aging', 'search', 'status', 'owner', 'collection', 'promise', 'contact', 'action', 'source', 'page']) {
    assert.match(service, new RegExp(`p_${key === 'minAmount' ? 'min_amount' : key}`));
  }
  assert.match(page, /const returnTo = `\$\{location\.pathname\}\$\{location\.search\}`/);
  assert.match(page, /params\.set\('returnTo', returnTo\)/);
});

test('opening balance remains separate from overdue invoice buckets', () => {
  assert.match(migration, /position\('الرصيد الافتتاحي'/);
  assert.match(migration, /'opening' = any\(v_aging\).*effective_kind = 'opening_balance'/s);
  assert.match(migration, /'inv90p' = any\(v_aging\).*effective_kind = 'invoice'.*age_days > 90/s);
});

test('changing URL filters never mixes the new Aging context with the previous page', () => {
  assert.match(page, /receivablesLoadedFilterKey/);
  assert.match(page, /receivablesLoadedFilterKey !== receivablesFilterKey/);
  assert.match(page, /const currentReceivablesPage = receivablesContextPending \? null : receivablesPage/);
  assert.match(page, /pending: receivablesContextPending/);
  assert.match(page, /جاري تحديث الشريحة؛ انتظر اكتمال النتائج/);
  assert.match(page, /loading=\{receivablesContextPending\}/);
});
