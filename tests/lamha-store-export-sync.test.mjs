import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const helperUrl = new URL('../supabase/functions/_shared/lamhaStoreExport.ts', import.meta.url);
const helperSource = await readFile(helperUrl, 'utf8');
const compiled = await transform(helperSource, { loader: 'ts', format: 'esm', target: 'es2022' });
const helper = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);

const headers = [
  'رقم المتجر', 'اسم المتجر', 'رقم الهاتف', 'عدد الشحنات', 'تاريخ اخر شحنة',
  'نوع الربط', 'نوع الفاتورة', 'حالة المتجر', 'حالة الملف الشخصي',
  'مسجل في الضريبة', 'مكمل بيانات زاتكا', 'حالة التوثيق', 'تاريخ الانشاء',
  'تاريخ اخر شحن رصيد', 'الرصيد الحالي',
];

test('Lamha authenticated export maps all operational enrichment fields', () => {
  const parsed = helper.parseLamhaStoreExportRows([
    headers,
    [1258, 'متجر تجريبي', 966500000000, 42, '2026-08-20', 'salla', 'prepaid', 'idle',
      'مكتمل', 'نعم', 'لا', 'موثق', '2025-11-09', '2026-08-28', 250.75],
  ]);
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.rows[0], {
    id: '1258',
    name: 'متجر تجريبي',
    phone: '966500000000',
    shipmentsCount: 42,
    lastShipmentDate: '2026-08-20T00:00:00.000Z',
    integrationType: 'salla',
    invoiceStatus: 'prepaid',
    status: 'idle',
    profileStatus: 'مكتمل',
    vatRegistered: true,
    zatcaCompleted: false,
    verificationStatus: 'موثق',
    joinDate: '2025-11-09T00:00:00.000Z',
    lastTopupAt: '2026-08-28T00:00:00.000Z',
    walletBalance: 250.75,
    _export: Object.fromEntries(headers.map((header, index) => [header, [1258, 'متجر تجريبي', 966500000000, 42, '2026-08-20', 'salla', 'prepaid', 'idle', 'مكتمل', 'نعم', 'لا', 'موثق', '2025-11-09', '2026-08-28', 250.75][index]])),
  });
});

test('Lamha export preserves zero wallet and rejects an incomplete contract', () => {
  const parsed = helper.parseLamhaStoreExportRows([
    headers,
    [1, 'صفر', '966500000001', 0, '', 'manual', 'postpaid', 'inactive', '', 'لا', 'لا', 'غير موثق', '2026-01-01', '', 0],
  ]);
  assert.equal(parsed.rows[0].walletBalance, 0);
  assert.equal(parsed.rows[0].vatRegistered, false);
  assert.equal(parsed.rows[0].zatcaCompleted, false);
  assert.throws(
    () => helper.parseLamhaStoreExportRows([headers.filter(header => header !== 'الرصيد الحالي'), [1, 'ناقص']]),
    /lamha_export_missing_columns:.*walletBalance/,
  );
});

test('automatic Lamha export replaces the manual store upload path in primary UX', async () => {
  const [guard, uploads, merchants, accounting, migration] = await Promise.all([
    readFile(new URL('../supabase/functions/lamha-financial-guard/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/uploadsHubService.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/Merchants.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/AccountingCycle.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260829082852_lamha_export_wallet_authority.sql', import.meta.url), 'utf8'),
  ]);
  assert.match(guard, /lamhaExportFetch/);
  assert.match(guard, /lamha_employee_api_export_scheduled/);
  assert.match(guard, /lamha_employee_api_export_manual/);
  assert.match(guard, /syncDirectory\(token, auth\.userId, auth\.kind === 'cron' \? 'cron' : 'user'\)/);
  assert.match(guard, /parsedExport\.rows\.length !== rawRows\.length/);
  assert.match(uploads, /تم إيقاف رفع دليل المتاجر يدويًا/);
  assert.doesNotMatch(uploads, /id:\s*'merchants'/);
  assert.match(merchants, /مزامنة من لمحة/);
  assert.doesNotMatch(merchants, /UploadModal|رفع كشف/);
  assert.match(accounting, /مصادر Lamha — مزامنة API آلية/);
  assert.match(accounting, /لا يلزم رفع ملف Excel يدوي/);
  assert.doesNotMatch(accounting, /sourceId="merchants"/);
  assert.match(migration, /lamha_export/);
  assert.match(migration, /excel_legacy/);
});
