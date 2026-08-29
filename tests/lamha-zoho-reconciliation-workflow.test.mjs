import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Lamha versus Zoho reconciliation is exact to the cent without tolerance', async () => {
  const [migration, service, page] = await Promise.all([
    read('supabase/migrations/20260829152200_exact_lamha_zoho_reconciliation.sql'),
    read('src/lib/reconciliationService.js'),
    read('src/pages/Reconciliation.jsx'),
  ]);
  assert.match(migration, /round\(\(j\.ibal - j\.zbal\)::numeric, 2\) = 0 then 'matched'/);
  assert.doesNotMatch(migration, /abs\(j\.ibal - j\.zbal\) <= 1/);
  assert.match(service, /Math\.round\(\(Number\(value\) \|\| 0\) \* 100\) \/ 100/);
  assert.match(service, /if \(diff === 0\) return 'matched'/);
  assert.match(page, /فرق 0\.01 يظهر في هذه القائمة/);
  assert.doesNotMatch(page, /Math\.abs\(r\.diff\) <= 1|قبول فرق حتى:/);
});

test('finance separates Zoho mirror integrity from Lamha statement reconciliation', async () => {
  const page = await read('src/pages/CustomerMoney.jsx');
  assert.match(page, /كشف لمحة × Zoho/);
  assert.match(page, /اتساق مرآة Zoho/);
  assert.match(page, /\/reconciliation\?tab=customers&differences=1&source=customer-finance/);
  assert.match(page, /\/zoho-data\?type=invoices&integrity=1/);
  assert.match(page, /lamhaZohoMismatchStoreIds/);
  assert.match(page, /financialHold: hasFinancialReconciliationHold\(c\)/);
  assert.match(page, /balanceSyncIssueKind: 'lamha_zoho'/);
});

test('reconciliation result set preserves context and source freshness', async () => {
  const [page, service, css] = await Promise.all([
    read('src/pages/Reconciliation.jsx'),
    read('src/lib/reconciliationService.js'),
    read('src/pages/Reconciliation.css'),
  ]);
  assert.match(page, /buildStore360Url/);
  assert.match(page, /source: 'lamha-zoho-reconciliation'/);
  assert.match(page, /returnTo: `\$\{location\.pathname\}\$\{location\.search\}`/);
  assert.match(page, /المصدران ضمن نافذة زمنية واحدة/);
  assert.match(page, /الفروقات للمراجعة وليست حكمًا نهائيًا بعد/);
  assert.match(service, /lamhaStale:/);
  assert.match(service, /zohoStale:/);
  assert.match(service, /sameWindow:/);
  assert.match(css, /\.reconciliation-source-context\.is-stale/);
  assert.match(css, /@media \(max-width: 700px\)/);
});

test('reconciliation lazy route recovers once and never exposes the raw module error', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /lazyWithRouteRecovery\('reconciliation'/);
  assert.match(app, /shipaudit:lazy-route-retry:/);
  assert.match(app, /تعذر تحميل مساحة العمل/);
  assert.match(app, /لم تتغير بياناتك/);
  assert.doesNotMatch(app, /String\(this\.state\.err\?\.message/);
});

