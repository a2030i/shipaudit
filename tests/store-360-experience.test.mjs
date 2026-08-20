import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { normalizeStoreTimeline, STORE_TIMELINE_FILTERS } from '../src/lib/store360Timeline.js';

const pagePath = new URL('../src/pages/Store360Page.jsx', import.meta.url);
const servicePath = new URL('../src/lib/store360Service.js', import.meta.url);
const customerWatchPath = new URL('../src/pages/CustomerWatch.jsx', import.meta.url);
const collectionsPath = new URL('../src/pages/Collections.jsx', import.meta.url);
const customerMoneyPath = new URL('../src/pages/CustomerMoney.jsx', import.meta.url);
const lamhaStatusServicePath = new URL('../src/lib/lamhaStoreStatusService.js', import.meta.url);
const lamhaOperationsPath = new URL('../src/components/LamhaStoreOperations.jsx', import.meta.url);
const merchantsPagePath = new URL('../src/pages/Merchants.jsx', import.meta.url);
const lamhaStatusFunctionPath = new URL('../supabase/functions/lamha-store-status/index.ts', import.meta.url);
const lamhaSyncFunctionPath = new URL('../supabase/functions/lamha-sync/index.ts', import.meta.url);
const lamhaRateLimitPath = new URL('../supabase/functions/_shared/lamhaRateLimit.ts', import.meta.url);
const lamhaRateLimitMigrationPath = new URL('../supabase/migrations/20260820083409_lamha_global_rate_limit.sql', import.meta.url);
const lamhaTokenRateLimitMigrationPath = new URL('../supabase/migrations/20260820133223_lamha_token_scoped_rate_limit.sql', import.meta.url);
const supabaseConfigPath = new URL('../supabase/config.toml', import.meta.url);

test('unified timeline keeps the experience contract, removes undated rows, and sorts newest first', () => {
  const rows = normalizeStoreTimeline({
    payments: [{ id: 1, date: '2026-08-18T10:00:00Z', amount: 120 }],
    sales: [
      { id: 2, created_at: '2026-08-19T10:00:00Z', outcome: 'interested' },
      { id: 3, outcome: 'must-not-be-invented' },
    ],
    shipments: [{ id: 4, order_date: '2026-08-17', awb: 'AWB-4', order_status: 'delivered' }],
  });

  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.type), ['sales', 'payment', 'shipment']);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), [
      'id', 'type', 'group', 'occurredAt', 'source', 'actor', 'title', 'outcome',
      'details', 'amount', 'status', 'detailUrl', 'sourceAvailability',
    ]);
    assert.match(row.occurredAt, /^2026-/);
  }
});

test('timeline exposes only the approved filters', () => {
  assert.deepEqual(STORE_TIMELINE_FILTERS.map(([id]) => id), [
    'all', 'finance', 'sales', 'collections', 'shipments', 'communications',
  ]);
});

test('Store 360 contains the approved six views and preserves URL context', async () => {
  const source = await readFile(pagePath, 'utf8');
  for (const label of [
    'نظرة عامة', 'المالية والفواتير', 'المبيعات والتحصيل',
    'الشحنات والناقلون', 'التواصل', 'النشاط الكامل',
  ]) assert.match(source, new RegExp(label));

  assert.match(source, /new URLSearchParams\(location\.search\)/);
  assert.match(source, /params\.get\('returnTo'\)/);
  assert.match(source, /params\.get\('invoice'\)/);
  assert.match(source, /contextParams\.get\('aging'\)/);
  assert.match(source, /next\.set\('view', nextView\)/);
  assert.match(source, /safeReturnTo\(params\.get\('returnTo'\), '\/customer-money'\)/);
});

test('Aging invoice drill-down remains inside Store 360 and labels promise balances', async () => {
  const source = await readFile(pagePath, 'utf8');
  assert.match(source, /s360-invoice-row/);
  assert.match(source, /onOpenInvoice\(invoice\)/);
  assert.match(source, /تفاصيل الفاتورة/);
  assert.match(source, /رصيد الشريحة/);
  assert.match(source, /رصيد المهمة عند إنشائها/);
  assert.match(source, /collection_tasks\.debt_at_creation/);
  assert.match(source, /إجمالي المتجر الحالي/);
  assert.match(source, /changeView\('finance', \{ invoice: null \}\)/);
});

test('financial attachment is exact by Store ID and shared phone stores stay informational', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /moneyRows\.find\(row => exactText\(row\.storeId, merchant\?\.storeId\)\)/);
  assert.doesNotMatch(source, /directMoney[\s\S]{0,180}normalizePhone/);
  assert.match(source, /sharedContactStores/);

  const page = await readFile(pagePath, 'utf8');
  assert.match(page, /متاجر تشترك في رقم التواصل/);
  assert.match(page, /تشابه رقم الاتصال لا يعني ملكية واحدة ولا تُجمع المبالغ بينها/);
  assert.match(page, /لا توجد بيانات مالية مرتبطة بهذا المتجر/);
});

test('secondary Store 360 data is loaded per selected view, not in the core request', async () => {
  const source = await readFile(pagePath, 'utf8');
  assert.match(source, /if \(target === 'finance'\) result = await loadStore360Finance/);
  assert.match(source, /if \(target === 'shipments'\) result = await loadStore360Shipments/);
  assert.match(source, /if \(target === 'communications'\) result = await loadStore360Communications/);
  assert.match(source, /if \(target === 'timeline'\) result = await loadStore360Timeline/);
  assert.match(source, /if \(!core \|\| target === 'overview'/);
  assert.match(source, /view !== 'work'/);

  const service = await readFile(servicePath, 'utf8');
  const financeLoader = service.slice(service.indexOf('export async function loadStore360Finance'), service.indexOf('export async function loadStore360Shipments'));
  assert.doesNotMatch(financeLoader, /listTasks/);
});

test('legacy customer directory opens the full Store 360 page and retains the previous location', async () => {
  const source = await readFile(customerWatchPath, 'utf8');
  assert.match(source, /params\.set\('returnTo', `\$\{location\.pathname\}\$\{location\.search\}`\)/);
  assert.match(source, /Full Store 360 owns the active experience/);
  assert.match(source, /setOpenCustomer\(null\)/);
  assert.match(source, /params\.set\('customer', identity\)/);
  assert.match(source, /params\.set\('open', '1'\)/);
  assert.match(source, /<Store360Page identity=\{profileIdentity\}/);
});

test('action center exposes permission-gated current actions and an unavailable reason', async () => {
  const source = await readFile(pagePath, 'utf8');
  for (const permission of [
    'sales.manage', 'collections.record_promise', 'campaigns.send', 'campaigns.ivr',
  ]) assert.match(source, new RegExp(permission.replace('.', '\\.')));
  assert.match(source, /const disabled = !onClick/);
  assert.match(source, /disabled && reason/);
  assert.match(source, /تحتاج صلاحية تشغيل IVR/);
});

test('Lamha store status action is admin-only, exact by Store ID, verified, and audited', async () => {
  const [page, service, edgeFunction, config] = await Promise.all([
    readFile(pagePath, 'utf8'),
    readFile(lamhaStatusServicePath, 'utf8'),
    readFile(lamhaStatusFunctionPath, 'utf8'),
    readFile(supabaseConfigPath, 'utf8'),
  ]);

  assert.match(page, /isAdmin/);
  assert.match(page, /store\.storeId/);
  assert.match(page, /إيقاف حساب لمحة/);
  assert.match(page, /تشغيل حساب لمحة/);
  assert.match(page, /هذا الإجراء متاح للمدير فقط/);
  assert.doesNotMatch(service, /phone|storeName|customer_name/);
  assert.match(service, /Number\.isSafeInteger\(id\)/);
  assert.match(service, /supabase\.functions\.invoke\('lamha-store-status'/);

  assert.match(edgeFunction, /profile\?\.role === 'admin'/);
  assert.match(edgeFunction, /Number\.isSafeInteger\(storeId\)/);
  assert.match(edgeFunction, /Authorization: `Bearer \$\{employeeToken\}`/);
  assert.match(edgeFunction, /const before = await lamhaRequest/);
  assert.match(edgeFunction, /const after = await lamhaRequest/);
  assert.match(edgeFunction, /candidate\.is_active \?\? candidate\.isActive/);
  assert.match(edgeFunction, /parseLamhaVisualActive/);
  assert.match(edgeFunction, /\['active', 'نشط'\]/);
  assert.match(edgeFunction, /\['inactive', 'غير نشط'\]/);
  assert.match(edgeFunction, /Idle\/stopped remain informational/);
  assert.match(edgeFunction, /visualStatusLabel/);
  assert.doesNotMatch(edgeFunction, /canCreateShipments: status == null/);
  assert.match(edgeFunction, /after\.store\.canCreateShipments !== desiredCanCreateShipments/);
  assert.doesNotMatch(edgeFunction, /!\['active', 'inactive'\]\.includes/);
  assert.match(page, /typeof lamhaStatus\.canCreateShipments !== 'boolean'/);
  assert.match(page, /إنشاء الشحنات/);
  assert.match(edgeFunction, /user_activity_log/);
  assert.match(config, /\[functions\.lamha-store-status\]\s+verify_jwt = true/);
});

test('Lamha operations supports reviewed bulk checks and uses only active/inactive Lamha statuses', async () => {
  const [component, service, edgeFunction, merchantsPage] = await Promise.all([
    readFile(lamhaOperationsPath, 'utf8'),
    readFile(lamhaStatusServicePath, 'utf8'),
    readFile(lamhaStatusFunctionPath, 'utf8'),
    readFile(merchantsPagePath, 'utf8'),
  ]);

  assert.match(merchantsPage, /حالة لمحة الحية/);
  assert.match(merchantsPage, /profile\?\.role === 'admin'/);
  assert.match(component, /تحديد كل النتائج/);
  assert.match(component, /مراجعة .* متاجر لمحة/);
  assert.match(component, /فحص كل النتائج/);
  assert.match(component, /خامل ومتوقف حالات متابعة/);
  assert.match(component, /إيقاف بعد الدفعة الحالية/);
  assert.match(component, /30 طلبًا في الدقيقة/);
  assert.match(service, /LAMHA_BATCH_SIZE = 10/);
  assert.match(service, /batch-\$\{action\}/);
  assert.match(service, /runLamhaStoreOperation/);
  assert.match(edgeFunction, /MAX_BATCH_SIZE = 10/);
  assert.match(edgeFunction, /batch-get/);
  assert.match(edgeFunction, /batch-activate/);
  assert.match(edgeFunction, /batch-deactivate/);
  assert.match(edgeFunction, /before\.store\.canCreateShipments === desiredCanCreateShipments/);
  assert.match(edgeFunction, /after\.store\.canCreateShipments !== desiredCanCreateShipments/);
});

test('every outbound Lamha function shares a server-side 30/minute budget by token, not endpoint', async () => {
  const [statusFunction, syncFunction, limiter, migration, tokenMigration] = await Promise.all([
    readFile(lamhaStatusFunctionPath, 'utf8'),
    readFile(lamhaSyncFunctionPath, 'utf8'),
    readFile(lamhaRateLimitPath, 'utf8'),
    readFile(lamhaRateLimitMigrationPath, 'utf8'),
    readFile(lamhaTokenRateLimitMigrationPath, 'utf8'),
  ]);

  assert.match(statusFunction, /waitForLamhaApiSlot\(admin, employeeToken,/);
  assert.match(syncFunction, /waitForLamhaApiSlot\(db, token,/);
  assert.match(limiter, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(limiter, /p_credential_key: credentialKey/);
  assert.match(limiter, /claim_lamha_api_request/);
  assert.match(limiter, /lamha_rate_limit_wait_timeout/);
  assert.match(migration, /create table if not exists private\.lamha_api_rate_limit_state/);
  assert.match(tokenMigration, /create table if not exists private\.lamha_api_token_rate_limit_state/);
  assert.match(tokenMigration, /credential_key text primary key/);
  assert.match(tokenMigration, /where credential_key = p_credential_key\s+for update/);
  assert.match(tokenMigration, /interval '2100 milliseconds'/);
  assert.match(tokenMigration, /'limit_per_minute', 30/);
  assert.match(tokenMigration, /coalesce\(auth\.jwt\(\) ->> 'role', ''\) <> 'service_role'/);
  assert.match(tokenMigration, /revoke all on function public\.claim_lamha_api_request\(text, text\) from public, anon, authenticated/);
  assert.match(tokenMigration, /grant execute on function public\.claim_lamha_api_request\(text, text\) to service_role/);
  assert.doesNotMatch(tokenMigration, /raw_token|employeeToken|LAMHA_EMPLOYEE_TOKEN/);
});

test('collection task drawer opens Store 360 with exact store when available and preserves return context', async () => {
  const source = await readFile(collectionsPath, 'utf8');
  assert.match(source, /customer\?\.merchant\?\.storeId \|\| task\.customer_name/);
  assert.match(source, /view: 'work'/);
  assert.match(source, /source: 'collections'/);
  assert.match(source, /returnTo: `\$\{location\.pathname\}\$\{location\.search\}`/);
  assert.match(source, /فتح Store 360/);
});

test('Aging customer card opens Store 360 with bucket, source, and return context', async () => {
  const source = await readFile(customerMoneyPath, 'utf8');
  assert.match(source, /customer: c\.storeId \|\| c\.name/);
  assert.match(source, /view: 'finance'/);
  assert.match(source, /source: 'aging'/);
  assert.match(source, /params\.set\('aging', bandKeys\.join\(','\)\)/);
  assert.match(source, /فتح ملف المتجر المالي الكامل/);
});
