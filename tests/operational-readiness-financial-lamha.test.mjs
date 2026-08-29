import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compareReceivablesFinancials } from '../src/lib/customerReceivablesRead.js';
import {
  buildFinancialPositionFromBalances, validateFinancialPosition,
} from '../src/lib/customerFinancialPosition.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('financial reconciliation treats one cent as a real mismatch', async () => {
  const customerMoney = await read('src/pages/CustomerMoney.jsx');
  assert.match(customerMoney, /moneyToMinorUnits\(agingDetailsTotal\) === moneyToMinorUnits\(agingDashboardTotal\)/);
  assert.doesNotMatch(customerMoney, /Math\.abs\(agingDetailsTotal - agingDashboardTotal\).*<=\s*0\.01/s);
  assert.deepEqual(compareReceivablesFinancials(
    { outstanding: 166487.88 },
    { dashboard: { outstanding: 166487.87 } },
  ), [{ field: 'outstanding', before: 166487.88, after: 166487.87 }]);
});

test('financial position keeps zero residual exact', () => {
  assert.deepEqual(buildFinancialPositionFromBalances([100]), {
    accountingOutstanding: 100,
    operationalCollectible: 100,
    residualBalance: 0,
    reconciledExactly: true,
  });
});

test('financial position keeps a 0.01 invoice as residual', () => {
  assert.deepEqual(buildFinancialPositionFromBalances([100, 0.01]), {
    accountingOutstanding: 100.01,
    operationalCollectible: 100,
    residualBalance: 0.01,
    reconciledExactly: true,
  });
});

test('financial position keeps a 0.50 invoice as residual', () => {
  assert.deepEqual(buildFinancialPositionFromBalances([100, 0.50]), {
    accountingOutstanding: 100.5,
    operationalCollectible: 100,
    residualBalance: 0.5,
    reconciledExactly: true,
  });
});

test('financial position includes a 0.51 invoice in operational collectible', () => {
  assert.deepEqual(buildFinancialPositionFromBalances([100, 0.51]), {
    accountingOutstanding: 100.51,
    operationalCollectible: 100.51,
    residualBalance: 0,
    reconciledExactly: true,
  });
});

test('multiple residual invoices remain outside operational collection item by item', () => {
  assert.deepEqual(buildFinancialPositionFromBalances([100, 0.01, 0.20, 0.50]), {
    accountingOutstanding: 100.71,
    operationalCollectible: 100,
    residualBalance: 0.71,
    reconciledExactly: true,
  });
});

test('mixed residual and collectible invoices reconcile at exact cent precision', () => {
  const position = buildFinancialPositionFromBalances([0.01, 0.50, 0.51, 100]);
  assert.deepEqual(position, {
    accountingOutstanding: 101.02,
    operationalCollectible: 100.51,
    residualBalance: 0.51,
    reconciledExactly: true,
  });
  assert.equal(validateFinancialPosition(position), true);
  assert.equal(validateFinancialPosition({ ...position, residualBalance: 0.50 }), false);
});

test('financial architecture exposes three distinct values and keeps actions operational', async () => {
  const migration = await read('supabase/migrations/20260828043040_customer_financial_operational_position.sql');
  const contract = await read('docs/architecture/financial-position-contract.md');
  const dashboard = await read('src/pages/CustomerMoney.jsx');
  const store360 = await read('src/pages/Store360Page.jsx');
  assert.match(migration, /accounting_outstanding/);
  assert.match(migration, /operational_collectible/);
  assert.match(migration, /residual_balance/);
  assert.match(migration, /security_invoker = true/);
  assert.match(migration, /grant select .* to authenticated/);
  assert.doesNotMatch(migration, /insert into|update public|delete from/i);
  assert.match(contract, /Accounting Outstanding/);
  assert.match(contract, /Operational Collectible/);
  assert.match(contract, /Residual Balance/);
  assert.match(dashboard, /d\.operationalCollectible/);
  assert.match(store360, /totalAmount: Number\(finance\.operationalCollectible\)/);
  assert.doesNotMatch(store360, /totalAmount: Number\(finance\.outstanding\)/);
});

test('the current financial contract exposes the threshold that can omit a residual invoice cent', async () => {
  const balanceMigration = await read('supabase/migrations/20260806180024_zoho_customer_balance_integrity.sql');
  const dashboardMigration = await read('supabase/migrations/20260815133000_optimize_customer_money_dashboard_timeout.sql');
  const queueMigration = await read('supabase/migrations/20260821193000_customer_receivables_work_queue.sql');
  assert.match(balanceMigration, /collectible_due[\s\S]*?outstanding_receivable/);
  assert.match(balanceMigration, /where i\.balance > 0\.5/);
  assert.match(dashboardMigration, /'outstanding'.*sum\(owed\)/);
  assert.match(queueMigration, /sum\(selected_amount\)/);
});

test('Lamha live read keeps exact endpoint, identity check, failure class and safe cache evidence', async () => {
  const edge = await read('supabase/functions/lamha-store-status/index.ts');
  assert.match(edge, /`\$\{LAMHA_BASE\}\/stores\/\$\{storeId\}\$\{action \? '\/status' : ''\}`/);
  assert.match(edge, /before\.store\.id !== storeId/);
  assert.match(edge, /lamha_store_not_found/);
  assert.match(edge, /lamha_auth_failed/);
  assert.match(edge, /lamha_identifier_mismatch/);
  assert.match(edge, /failureClass/);
  assert.match(edge, /retryable/);
  assert.match(edge, /responseStoreId/);
  assert.match(edge, /attempts/);
  assert.doesNotMatch(edge, /raw_response|response_body|payload:\s*payload/);
});

test('Lamha bounded retry applies only to safe reads and not PATCH writes', async () => {
  const edge = await read('supabase/functions/lamha-store-status/index.ts');
  assert.match(edge, /const maxAttempts = action \? 1 : READ_RETRY_LIMIT \+ 1/);
  assert.match(edge, /const READ_RETRY_LIMIT = 1/);
  assert.match(edge, /TRANSIENT_HTTP_STATUSES\.has\(response\.status\)/);
});

test('Lamha account enablement treats inactive alone as disabled', async () => {
  const edge = await read('supabase/functions/lamha-store-status/index.ts');
  assert.match(edge, /\['active', 'idle', 'stopped', 'نشط', 'خامل', 'متوقف', 'موقوف'\]\.includes\(normalized\)/);
  assert.match(edge, /\['inactive', 'غير نشط'\]\.includes\(normalized\)/);
  assert.match(edge, /const canCreateShipments = explicitOperational \?\? statusAccountEnabled/);
  assert.match(edge, /'lamha_status_contract'/);
  assert.doesNotMatch(edge, /candidate\.owner_activated|candidate\.ownerActivated/);
});

test('Lamha status cache rejects observations created before the enablement contract', async () => {
  const edge = await read('supabase/functions/lamha-store-status/index.ts');
  assert.match(edge, /const STATUS_CONTRACT_VERSION = 2/);
  assert.match(edge, /statusContractVersion: STATUS_CONTRACT_VERSION/);
  assert.match(edge, /Number\(raw\?\.statusContractVersion\) !== STATUS_CONTRACT_VERSION/);
});

test('Customer 360 never promotes the visual merchant snapshot to a verified Lamha status', async () => {
  const store360 = await read('src/pages/Store360Page.jsx');
  assert.match(store360, /loadCachedLamhaStoreStatuses\(\[id\]\)/);
  assert.match(store360, /isLamhaStatusResultFresh\(result\)/);
  assert.match(store360, /state: 'unverified'/);
  assert.match(store360, /الحالة البصرية:.*يلزم فحص مباشر/);
  assert.match(store360, /'فحص مباشر'\}<\/button>/);
  assert.doesNotMatch(store360, /source: 'local' \}\);\s*return undefined/);
});
