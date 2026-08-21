import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { transform } from 'esbuild';

const helperUrl = new URL('../supabase/functions/_shared/lamhaFinancialGuard.ts', import.meta.url);
const helperSource = await readFile(helperUrl, 'utf8');
const compiled = await transform(helperSource, { loader: 'ts', format: 'esm', target: 'es2022' });
const helper = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);

test('Lamha directory parser handles the paginated response used by the browser', () => {
  const page = helper.extractLamhaStorePage({
    data: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }],
    meta: { current_page: 1, last_page: 33, total: 1614, per_page: 50 },
  });
  assert.equal(page.rows.length, 2);
  assert.equal(page.currentPage, 1);
  assert.equal(page.lastPage, 33);
  assert.equal(page.total, 1614);
});

test('normalization updates visible directory fields and preserves unavailable snapshot fields', () => {
  const row = helper.normalizeLamhaStoreRow({
    id: 847,
    name: 'متجر الأندية',
    phone: '966550413239',
    status: { label: 'نشط' },
    shipmentsCount: 25,
    lastShipmentAt: '2026-08-20T12:00:00Z',
    createdAt: '2025-01-01T00:00:00Z',
  }, {
    wallet_balance: 123.45,
    last_topup_at: '2026-08-01T00:00:00Z',
    billing_type: 'دفع مسبق',
  });
  assert.equal(row.store_id, '847');
  assert.equal(row.status, 'نشط');
  assert.equal(row.shipment_count, 25);
  assert.equal(row.wallet_balance, 123.45);
  assert.equal(row.billing_type, 'دفع مسبق');
  assert.equal(row.last_topup_at, '2026-08-01T00:00:00.000Z');
});

test('financial guard includes opening balances older than 30 days and excludes invoice drafts', () => {
  const rows = helper.buildFinancialGuardRows({
    merchants: [{ store_id: '847', store_name: 'متجر الأندية', status: 'نشط' }],
    links: [{ customer_name: 'الأندية', store_id: 847 }],
    validCustomers: new Set(['الأندية']),
    lines: [
      { contact_name: 'الأندية', line_kind: 'invoice', line_id: 'i1', collectible_amount: 100, age_days: 31 },
      { contact_name: 'الأندية', line_kind: 'invoice', line_id: 'i2', collectible_amount: 200, age_days: 30 },
      { contact_name: 'الأندية', line_kind: 'opening_balance', line_id: 'o1', collectible_amount: 500, age_days: 200 },
      { contact_name: 'الأندية', line_kind: 'invoice', line_id: 'draft', status: 'draft', collectible_amount: 900, age_days: 120 },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].overdue30Amount, 600);
  assert.equal(rows[0].overdue30InvoiceAmount, 100);
  assert.equal(rows[0].overdue30OpeningBalanceAmount, 500);
  assert.equal(rows[0].overdue30InvoiceCount, 1);
  assert.equal(rows[0].overdue30OpeningBalanceCount, 1);
  assert.equal(rows[0].oldestOverdueDays, 200);
  assert.equal(helper.financialGuardDecision(rows[0], false).action, 'deactivate');
});

test('automatic activation is allowed only for a hold owned by this guard', () => {
  const clearInactive = {
    storeId: 9,
    storeName: 'Test',
    customerNames: ['Test'],
    overdue30Amount: 0,
    overdue30InvoiceCount: 0,
    oldestOverdueDays: 0,
    financeValid: true,
    visualActive: false,
  };
  assert.equal(helper.financialGuardDecision(clearInactive, false).action, 'exclude');
  assert.equal(helper.financialGuardDecision(clearInactive, true).action, 'activate');
  assert.equal(helper.financialGuardDecision({ ...clearInactive, financeValid: false }, true).action, 'exclude');
});

test('cron template maps midnight Riyadh to 21:00 UTC and never embeds a secret', async () => {
  const cron = await readFile(new URL('../supabase/cron/lamha-financial-guard.sql.template', import.meta.url), 'utf8');
  assert.match(cron, /'0 21 \* \* \*'/);
  assert.match(cron, /lamha_financial_guard_cron_secret/);
  assert.doesNotMatch(cron, /Bearer\s+[A-Za-z0-9._-]{20,}/);
});

test('automation stays disabled unless explicitly provisioned and verifies both data sources', async () => {
  const source = await readFile(new URL('../supabase/functions/lamha-financial-guard/index.ts', import.meta.url), 'utf8');
  assert.match(source, /LAMHA_FINANCIAL_GUARD_EXECUTION_ENABLED/);
  assert.match(source, /=== 'true'/);
  assert.match(source, /zohoFresh && platformFresh/);
  assert.match(source, /MAX_CHANGES_PER_POLICY_RUN = 10/);
  assert.match(helperSource, /inactive_not_owned_by_financial_guard/);
  assert.match(source, /latest\.createdAt <= policy\.snapshotAt/);
  assert.match(source, /latest\?\.automatic && latest\.action === 'deactivate'/);
  assert.match(source, /source_read_failed/);
});
