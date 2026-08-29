import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

async function importSource(url, loader = 'js') {
  const source = await readFile(url, 'utf8');
  const compiled = await transform(source, { loader, format: 'esm', target: 'es2022' });
  return import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
}

const profileHelper = await importSource(
  new URL('../supabase/functions/_shared/lamhaStoreProfile.ts', import.meta.url),
  'ts',
);
const accountState = await importSource(
  new URL('../src/lib/lamhaAccountState.js', import.meta.url),
);

test('Lamha profile extraction retains useful current and future fields without request secrets', () => {
  const record = profileHelper.lamhaStoreProfileRecord({
    data: {
      id: 1258,
      name: 'متجر تجريبي',
      city: 'الرياض',
      accountingProvider: 'Zoho',
      pendingRevenue: 90.25,
      futureField: { enabled: true },
    },
  }, 1258);
  const row = profileHelper.lamhaProfileMergeRow({
    storeId: 1258,
    record,
    detailCheckedAt: '2026-08-28T12:00:00Z',
    httpStatus: 200,
    latencyMs: 123.6,
  });
  assert.equal(row.api_data.city, 'الرياض');
  assert.equal(row.api_data.accountingProvider, 'Zoho');
  assert.equal(row.api_data.pendingRevenue, 90.25);
  assert.deepEqual(row.api_data.futureField, { enabled: true });
  assert.equal(row.api_latency_ms, 124);
  assert.equal('authorization' in row.api_data, false);
});

test('one account-state contract treats inactive alone as disabled', () => {
  for (const status of ['active', 'idle', 'stopped', 'future_status', 'نشط', 'خامل', 'متوقف']) {
    assert.equal(accountState.lamhaAccountState(status), 'enabled', status);
  }
  assert.equal(accountState.lamhaAccountState('inactive'), 'disabled');
  assert.equal(accountState.lamhaAccountState('غير نشط'), 'disabled');
  assert.equal(accountState.lamhaAccountState(''), 'unknown');
  assert.equal(accountState.isLamhaLifecycleStopped('stopped'), true);
  assert.equal(accountState.isLamhaLifecycleStopped('inactive'), false);
});

test('profile registry keeps API and Excel separate with API precedence', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20260828151355_lamha_store_profile_registry.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /api_data jsonb not null/);
  assert.match(migration, /excel_data jsonb not null/);
  assert.match(migration, /jsonb_strip_nulls\(v_profile\.excel_data\) \|\| jsonb_strip_nulls\(v_profile\.api_data\)/);
  assert.match(migration, /merge_lamha_store_profiles_from_excel/);
  assert.match(migration, /crm_has_permission\('merchants\.upload'\)/);
  assert.match(migration, /revoke all on table public\.lamha_store_profiles from public, anon, authenticated/);
  assert.match(migration, /inactive.*غيرنشط/);
});

test('production authority migration removes shared Excel fields and exposes provenance', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20260828155754_lamha_api_authority_and_detail_backfill.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /lamha_excel_enrichment/);
  assert.match(migration, /profileStatus/);
  assert.match(migration, /walletBalance/);
  assert.match(migration, /fieldSources/);
  assert.match(migration, /verificationStatus/);
  assert.match(migration, /sync-profile-details/);
  assert.doesNotMatch(migration, /body := '\{"action":"policy"\}'/);
  assert.doesNotMatch(migration, /PATCH|activate|deactivate/);
});

test('merchant snapshot ingestion preserves missing Excel-only values as null', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260828161452_preserve_missing_lamha_enrichment_as_null.sql', import.meta.url), 'utf8');
  assert.match(migration, /round\(row_data\.wallet_balance::numeric, 2\)/);
  assert.match(migration, /row_data\.vat_registered/);
  assert.match(migration, /row_data\.zatca_completed/);
  assert.doesNotMatch(migration, /coalesce\(row_data\.wallet_balance,\s*0\)/);
  assert.doesNotMatch(migration, /coalesce\(row_data\.(?:vat_registered|zatca_completed),\s*false\)/);
});

test('Excel parser retains unknown columns and does not invent a missing wallet fallback', async () => {
  const merchantsSource = await readFile(new URL('../src/lib/merchantsService.js', import.meta.url), 'utf8');
  const withoutImports = merchantsSource
    .replace(/import \{ supabase \} from '\.\/supabase\.js';/, 'const supabase = {};')
    .replace(/import \{[\s\S]*?\} from '\.\/lamhaAccountState\.js';/, `
      const normalizeLamhaStatus = value => String(value ?? '').trim().toLowerCase().replace(/[\\s_-]+/g, ' ');
      const isLamhaAccountEnabled = value => !!normalizeLamhaStatus(value) && !['inactive','غير نشط'].includes(normalizeLamhaStatus(value));
      const isLamhaAccountDisabled = value => ['inactive','غير نشط'].includes(normalizeLamhaStatus(value));
      const isLamhaLifecycleStopped = value => normalizeLamhaStatus(value) === 'stopped';
    `);
  const compiled = await transform(withoutImports, { loader: 'js', format: 'esm', target: 'es2022' });
  const merchants = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
  const parsed = merchants.parseStoresFile([
    ['رقم المتجر', 'اسم المتجر', 'رقم الهاتف', 'المدينة', 'حقل جديد'],
    [1258, 'متجر تجريبي', '966500000000', 'الرياض', 'قيمة'],
  ]);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].excelData._excel['المدينة'], 'الرياض');
  assert.equal(parsed.rows[0].excelData._excel['حقل جديد'], 'قيمة');
  assert.equal(Object.hasOwn(parsed.rows[0].excelData, 'walletBalance'), false);
  assert.equal(Object.hasOwn(parsed.rows[0].excelData, 'phone'), false);
  assert.equal(Object.hasOwn(parsed.rows[0].excelData, 'name'), false);
  assert.equal(Object.hasOwn(parsed.rows[0].excelData, 'status'), false);
});

test('Excel canonical enrichment keeps only fields unavailable from Lamha API', async () => {
  const merchantsSource = await readFile(new URL('../src/lib/merchantsService.js', import.meta.url), 'utf8');
  const withoutImports = merchantsSource
    .replace(/import \{ supabase \} from '\.\/supabase\.js';/, 'const supabase = {};')
    .replace(/import \{[\s\S]*?\} from '\.\/lamhaAccountState\.js';/, `
      const normalizeLamhaStatus = value => String(value ?? '').trim().toLowerCase();
      const isLamhaAccountEnabled = value => value !== 'inactive';
      const isLamhaAccountDisabled = value => value === 'inactive';
      const isLamhaLifecycleStopped = value => value === 'stopped';
    `);
  const compiled = await transform(withoutImports, { loader: 'js', format: 'esm', target: 'es2022' });
  const merchants = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
  const parsed = merchants.parseStoresFile([
    ['رقم المتجر', 'اسم المتجر', 'رقم الهاتف', 'حالة المتجر', 'حالة التوثيق', 'حالة الملف الشخصي', 'مسجل في الضريبة', 'مكمل بيانات زاتكا', 'تاريخ اخر شحن رصيد', 'الرصيد الحالي'],
    [1258, 'متجر تجريبي', '966500000000', 'نشط', 'موثق', 'مكتمل', 'نعم', 'لا', '2026-08-27', 42.5],
  ]);
  const enrichment = parsed.rows[0].excelData;
  assert.deepEqual(
    Object.keys(enrichment).sort(),
    ['_excel', 'lastTopupAt', 'profileStatus', 'vatRegistered', 'walletBalance', 'zatcaCompleted'].sort(),
  );
  assert.equal(enrichment.walletBalance, 42.5);
  assert.equal(enrichment.profileStatus, 'مكتمل');
  assert.equal(enrichment._excel['حالة المتجر'], 'نشط');
  assert.equal(Object.hasOwn(enrichment, 'verificationStatus'), false);
});

test('V2 Excel upload is enrichment-only and cannot create an operational snapshot', async () => {
  const merchantsSource = await readFile(new URL('../src/lib/merchantsService.js', import.meta.url), 'utf8');
  const start = merchantsSource.indexOf('export async function uploadLamhaExcelEnrichment');
  const end = merchantsSource.indexOf('// Returns the merchants', start);
  const body = start >= 0 && end > start ? merchantsSource.slice(start, end) : '';
  assert.match(body, /merge_lamha_store_profiles_from_excel/);
  assert.doesNotMatch(body, /from\('merchants'\)|ingest_platform_merchant_snapshot|capture_merchant_lifecycle_events/);
});
