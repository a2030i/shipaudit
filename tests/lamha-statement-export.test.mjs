import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const helperUrl = new URL('../supabase/functions/_shared/lamhaStatementExport.ts', import.meta.url);
const helperSource = await readFile(helperUrl, 'utf8');
const compiled = await transform(helperSource, { loader: 'ts', format: 'esm', target: 'es2022' });
const helper = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);

const headers = ['#', 'المتجر', 'حالة المتجر', 'حالة الحساب', 'مدين', 'دائن', 'الرصيد', 'معلّق', 'آخر عملية'];

test('Lamha statement export preserves its financial values and account context', () => {
  const parsed = helper.parseLamhaStatementExportRows([
    headers,
    [1258, 'متجر تجريبي', 'نشط', 'مستحق', 300.25, 200, -100.25, 15, '2026-08-29 10:00:00'],
    [1259, 'متجر صفري', 'خامل', 'مسدد', 50, 50, null, null, '2026-08-28 09:00:00'],
  ]);

  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.rows[0], {
    storeId: '1258',
    storeName: 'متجر تجريبي',
    storeStatus: 'نشط',
    accountStatus: 'مستحق',
    debit: 300.25,
    credit: 200,
    balance: -100.25,
    pending: 15,
    lastTransactionAt: '2026-08-29 10:00:00',
  });
  assert.equal(parsed.rows[1].balance, null);
});

test('Lamha statement export rejects a missing financial contract', () => {
  assert.throws(
    () => helper.parseLamhaStatementExportRows([
      headers.filter(header => header !== 'الرصيد'),
      [1258, 'متجر ناقص'],
    ]),
    /lamha_statement_export_contract_invalid/,
  );
});

test('statement probe is read-only, uses the employee secret, and never returns raw rows', async () => {
  const source = await readFile(new URL('../supabase/functions/lamha-financial-guard/index.ts', import.meta.url), 'utf8');
  const probeSource = source.slice(
    source.indexOf('async function probeStatementExport'),
    source.indexOf('function nestedStoreRecords'),
  );
  assert.match(source, /Deno\.env\.get\('LAMHA_EMPLOYEE_TOKEN'\)/);
  assert.match(source, /\/stores\/statements\/export/);
  assert.match(source, /probe-statement-export/);
  assert.match(probeSource, /readOnly: true/);
  assert.doesNotMatch(probeSource, /method:\s*'PATCH'/);
  assert.doesNotMatch(probeSource, /rows:\s*parsed\.rows/);
});
