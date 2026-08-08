import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('invoice sync preserves nested and durable ZATCA status', async () => {
  const sync = await read('supabase/functions/zoho-sync/index.ts');
  assert.match(sync, /einvoice_details/);
  assert.match(sync, /preserveInvoiceStatuses/);
  assert.match(sync, /cfg\.table === 'zoho_invoices'/);
});

test('full Zoho reconciliation records a tombstone before deletion', async () => {
  const sync = await read('supabase/functions/zoho-sync/index.ts');
  assert.match(sync, /cfg\.reconcileDeletes && !more && since === null/);
  assert.match(sync, /zoho_mirror_tombstones/);
  assert.ok(sync.indexOf("from('zoho_mirror_tombstones').insert") < sync.indexOf("from(cfg.table).delete"));
});

test('ZATCA agent live-checks blank status and promotes draft invoices', async () => {
  const agent = await read('supabase/functions/zatca-auto-push/index.ts');
  assert.match(agent, /mark_sent_then_push/);
  assert.match(agent, /status\/sent/);
  assert.match(agent, /einvoice\/push/);
  assert.match(agent, /recent_blank_safety_net/);
});

test('OAuth and mirror include purchase orders and purchase details', async () => {
  const auth = await read('supabase/functions/zoho-authurl/index.ts');
  const sync = await read('supabase/functions/zoho-sync/index.ts');
  const service = await read('src/lib/pnlService.js');
  const page = await read('src/pages/ZohoData.jsx');
  assert.match(auth, /ZohoBooks\.purchaseorders\.READ/);
  assert.match(sync, /zoho_purchase_orders/);
  assert.match(sync, /zoho_vendor_payments/);
  assert.match(sync, /detail_synced_at/);
  assert.match(service, /purchase_orders:\s*\{\s*table: 'zoho_purchase_orders'/);
  assert.match(page, /الموردون والمشتريات/);
});

test('integration migration provides aging, API monitoring, and bank decisions', async () => {
  const migration = await read('supabase/migrations/20260808000641_zoho_integration_completeness.sql');
  assert.match(migration, /zoho_ar_aging_current/);
  assert.match(migration, /zoho_ap_aging_current/);
  assert.match(migration, /zoho_api_monitor_config/);
  assert.match(migration, /classify_bank_transaction/);
  assert.match(migration, /bank_transaction_matches/);
  assert.match(migration, /zoho-full-reconcile-weekly/);
});

test('bank ledger exposes classification and matching controls', async () => {
  const page = await read('src/pages/BankStatement.jsx');
  const service = await read('src/lib/bankTransactionsService.js');
  assert.match(page, /تصنيف ومطابقة العملية البنكية/);
  assert.match(page, /كل حالات التصنيف/);
  assert.match(service, /classify_bank_transaction/);
  assert.match(service, /classification_status/);
});
