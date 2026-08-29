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

test('financial guard uses the Lamha account contract: inactive alone is disabled', () => {
  for (const status of ['active', 'idle', 'stopped', 'enabled', 'نشط', 'خامل', 'متوقف', 'موقوف', 'future_status']) {
    assert.equal(helper.parseLamhaAccountActive(status), true, status);
  }
  assert.equal(helper.parseLamhaAccountActive('inactive'), false);
  assert.equal(helper.parseLamhaAccountActive('غير نشط'), false);
  assert.equal(helper.parseLamhaAccountActive('false'), false, 'an explicit operational boolean is not a status label');
  assert.equal(helper.parseLamhaAccountActive(null), null);
});

test('Lamha detail field aliases update only matching merchant meanings', () => {
  const row = helper.normalizeLamhaStoreRow({
    id: 1258,
    name: 'متجر تجريبي',
    phone: '966500000000',
    status: 'idle',
    invoiceStatus: 'postpaid',
    joinDate: '2025-11-09',
    lastShipmentDate: '2026-08-20',
    monthlyAvgOrders: 16,
    ownerActivated: false,
    hasWalletTransactions: true,
    verified: false,
  }, { shipment_count: 240, wallet_balance: 90 });
  assert.equal(row.status, 'idle');
  assert.equal(row.billing_type, 'دفع لاحق');
  assert.equal(row.created_at_platform, '2025-11-09T00:00:00.000Z');
  assert.equal(row.last_shipment_at, '2026-08-20T00:00:00.000Z');
  assert.equal(row.shipment_count, 240, 'monthlyAvgOrders must not replace total shipments');
  assert.equal(row.wallet_balance, 90, 'wallet transaction presence must not replace wallet balance');
  assert.equal(row.verification_status, 'غير موثق', 'Lamha API verification must replace the Excel fallback');
});

test('missing Excel-only financial fields remain unknown instead of becoming zero', () => {
  const row = helper.normalizeLamhaStoreRow({
    id: 1258,
    name: 'متجر بلا رصيد في الملف',
    status: 'active',
    invoiceStatus: 'prepaid',
  });
  assert.equal(row.wallet_balance, null);
  assert.equal(row.vat_registered, null);
  assert.equal(row.zatca_completed, null);
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
  assert.match(cron, /"action":"sync-directory"/);
  assert.match(cron, /"action":"sync-profile-details"/);
  assert.match(cron, /'7,22,37,52 \* \* \* \*'/);
  assert.doesNotMatch(cron, /"action":"policy"/);
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
  assert.match(source, /db\.rpc\('authorize_lamha_directory_cron'/);
  assert.match(source, /sync-profile-details/);
  assert.match(source, /PROFILE_DETAIL_CATCHUP_BUDGET = 24/);
  assert.match(source, /PROFILE_DETAIL_REFRESH_MS = 7/);
  assert.match(source, /read_only: true/);
  assert.match(source, /previous_matches=/);
  assert.match(source, /\.range\(from, from \+ DATABASE_PAGE_SIZE - 1\)/);
  assert.match(source, /reportedTotal/);
  assert.match(source, /DIRECTORY_PAGE_SIZE = 200/);
  assert.match(source, /DIRECTORY_STABLE_SORT = 'sort_by=id&sort_direction=asc'/);
  assert.match(source, /rawRows\.length < reportedTotal/);
  assert.match(source, /lamha_directory_incomplete/);
  assert.match(source, /`\/stores\/\$\{id\}`/);
  assert.match(source, /x-ratelimit-remaining/);
  assert.match(source, /PROFILE_DETAIL_BUDGET = 18/);
  assert.match(source, /merge_lamha_store_profiles_from_api/);
  assert.match(source, /profile_detail_rows/);
  assert.match(source, /excelFallbackStores/);
});

test('daily Lamha migration schedules read-only sync and removes the policy worker', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260828082515_lamha_daily_read_sync.sql', import.meta.url), 'utf8');
  assert.match(migration, /'0 21 \* \* \*'/);
  assert.match(migration, /"action":"sync-directory"/);
  assert.match(migration, /lamha-financial-guard-0005-0255-riyadh/);
  assert.match(migration, /authorize_lamha_directory_cron/);
  assert.match(migration, /revoke execute[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /"action":"policy"/);
  assert.doesNotMatch(migration, /PATCH|activate|deactivate/i);
  const timeoutMigration = await readFile(new URL('../supabase/migrations/20260828083439_lamha_daily_read_sync_timeout.sql', import.meta.url), 'utf8');
  assert.match(timeoutMigration, /timeout_milliseconds := 300000/);
  assert.match(timeoutMigration, /"action":"sync-directory"/);
  assert.doesNotMatch(timeoutMigration, /"action":"policy"|PATCH|activate|deactivate/i);
});
