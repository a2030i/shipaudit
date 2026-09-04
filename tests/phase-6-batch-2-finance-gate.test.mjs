import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const tablePages = [
  'src/pages/BankStatement.jsx',
  'src/pages/CodSettlements.jsx',
  'src/pages/Payments.jsx',
  'src/pages/ZohoData.jsx',
  'src/pages/Reconciliation.jsx',
  'src/pages/CashAging.jsx',
  'src/pages/Periods.jsx',
];

test('Batch 2 has one canonical finance workspace navigation', async () => {
  const nav = await read('src/components/enterprise/FinanceWorkspaceNav.jsx');
  for (const id of ['overview', 'receivables', 'collections', 'cash', 'reconciliation', 'payables', 'control']) {
    assert.match(nav, new RegExp(`id: '${id}'`));
  }
  for (const route of ['/workspace/finance', '/customer-money?view=money', '/money?tab=bank', '/reconciliation?tab=customers', '/zoho-data?tab=vendors&type=bills', '/pnl']) {
    assert.ok(nav.includes(route), `missing canonical finance destination ${route}`);
  }
});

test('Batch 2 financial tables use the shared DataTable primitive', async () => {
  for (const path of tablePages) {
    const source = await read(path);
    assert.doesNotMatch(source, /<\/?table\b/i, `${path} still owns a raw table implementation`);
    assert.match(source, /<DataTable\b/, `${path} does not use the shared table primitive`);
  }
});

test('finance workspaces share the PageHeader, Breadcrumbs and workspace navigation contracts', async () => {
  const pages = [
    'src/pages/CollectionsHub.jsx',
    'src/pages/MoneyHub.jsx',
    'src/pages/ZohoData.jsx',
    'src/pages/Reconciliation.jsx',
    'src/pages/FinancialPosition.jsx',
    'src/pages/CashAging.jsx',
    'src/pages/Forecast.jsx',
    'src/pages/Periods.jsx',
  ];
  for (const path of pages) {
    const source = await read(path);
    assert.match(source, /FinanceWorkspaceNav/);
    if (!path.endsWith('MoneyHub.jsx') && !path.endsWith('CollectionsHub.jsx')) {
      assert.match(source, /Breadcrumbs/);
      assert.match(source, /design-system\/EnterpriseUI\.jsx/);
    }
  }
});

test('reconciliation exposes traceable result sets without inventing currency or journal links', async () => {
  const source = await read('src/pages/Reconciliation.jsx');
  for (const label of ['مطابق', 'غير مطابق', 'مصدر مفقود', 'فروق الرصيد', 'مشاكل العملة', 'استثناءات القيود']) {
    assert.ok(source.includes(label), `missing reconciliation result set: ${label}`);
  }
  assert.match(source, /المصدر الحالي لا يعيد استثناء عملة/);
  assert.match(source, /لا يوجد ربط تخميني/);
  assert.match(source, /r\.diff !== 0/);
  assert.match(source, /يشمل فرق 0\.01/);
});

test('cash workspace explicitly separates bank actual, book balance and reconciliation differences', async () => {
  const source = await read('src/pages/MoneyHub.jsx');
  assert.match(source, /الرصيد البنكي الفعلي/);
  assert.match(source, /الرصيد الدفتري/);
  assert.match(source, /الفروقات لا تُدمج في رقم واحد/);
});

test('legacy money routes preserve query and entity context through the canonical workspace', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /\['\/bank', '\/cod-settlements', '\/payments'\]\.includes\(rawPath\)/);
  assert.match(app, /new URLSearchParams\(params\)/);
  assert.match(app, /navigate\(`\/money\?\$\{next\.toString\(\)\}`/);
  assert.match(app, /!params\.get\('carrier'\)/);
});
