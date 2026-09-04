import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('finance primary navigation opens a real executive workspace instead of restoring a historical table', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /const FinanceExecutive = lazy\(\(\) => import\('\.\/pages\/FinanceExecutive\.jsx'\)\)/);
  assert.match(app, /if \(center && !\['finance', 'sales', 'campaigns', 'customers', 'reports', 'settings'\]\.includes\(center\.id\)\)/);
  assert.match(app, /section\.id === 'finance'[\s\S]*?<FinanceExecutive carriers=\{carriers\} isActive=\{pathname === section\.path\}/);
  assert.doesNotMatch(app, /<PageSlot key=\{section\.id\} active=\{pathname === section\.path\} scroll>\s*<Navigate/);
  assert.match(app, /<button key=\{it\.path\} onClick=\{\(\) => it\.sectionId === 'more' \? openNavigation\(null\) : goto\(it\.path\)\}/);
});

test('finance executive read model uses existing read-only sources in parallel', async () => {
  const page = await read('src/pages/FinanceExecutive.jsx');
  assert.match(page, /Promise\.allSettled\(\[/);
  assert.match(page, /loadOverviewRead\(\{ period: period \|\| currentPeriod\(\), topN: 5, mode: 'core' \}\)/);
  assert.match(page, /loadPnlSnapshots\(\)/);
  assert.match(page, /loadInvoicedVsCollected\(period\)/);
  assert.match(page, /loadZohoFinancialDashboard\(\)/);
  assert.match(page, /loadCashflowForecast\(\{ horizonDays: 7, carriers \}\)/);
  assert.doesNotMatch(page, /refreshPnlMonth|syncZoho|setZohoFinancialAccountLink|applyZohoCredits/);
});

test('finance executive answers the manager questions and drills into existing operational views', async () => {
  const page = await read('src/pages/FinanceExecutive.jsx');
  for (const label of [
    'صافي الربح', 'فوترنا هذا الشهر', 'النقد والبنوك', 'القابل للتحصيل تشغيليًا',
    'صافي الموردين', 'ضريبة', 'الموردون والمشتريات', 'البنوك والخزائن',
    'شجرة الحسابات والقيود', 'المطابقة والرقابة', 'أداء المتاجر',
  ]) assert.match(page, new RegExp(label));
  assert.match(page, /\/customer-money\?worklist=1&returnTo=%2Fworkspace%2Ffinance/);
  assert.match(page, /\/zoho-data\?tab=vendors&type=bills/);
  assert.match(page, /\/zoho-data\?tab=banks&type=bank_accounts/);
  assert.match(page, /\/zoho-data\?tab=accounts&type=chart_accounts/);
  assert.match(page, /\/forecast/);
  assert.match(page, /\/reconciliation/);
});

test('finance executive preserves exact accounting versus operational separation', async () => {
  const page = await read('src/pages/FinanceExecutive.jsx');
  assert.match(page, /accountingOutstanding - operationalCollectible/);
  assert.match(page, /Math\.round\(residual \* 100\) !== 0/);
  assert.match(page, /الرصيد الهامشي\/غير التشغيلي/);
  assert.match(page, /لا يدخل تلقائيًا في التحصيل أو الإيقاف/);
  assert.doesNotMatch(page, /tolerance|epsilon|Math\.abs\(residual\).*0\.0/);
});

test('finance visualizations keep direct values and a compact mobile reading path', async () => {
  const [page, css] = await Promise.all([
    read('src/pages/FinanceExecutive.jsx'),
    read('src/pages/finance-executive.css'),
  ]);
  assert.match(page, /function PnlBridge/);
  assert.match(page, /function CashProjectionChart/);
  assert.match(page, /<title id="fex-cash-title">توقع رصيد السيولة خلال سبعة أيام<\/title>/);
  assert.match(page, /function MerchantPulse/);
  assert.match(page, /aria-label=\{`يعمل \$\{active\}، موقوف \$\{inactive\}، غير محسوم \$\{unknown\}`\}/);
  assert.match(css, /@media\(max-width:800px\)/);
  assert.match(css, /\.fex-metrics\{display:flex;overflow-x:auto;scroll-snap-type:x mandatory/);
  assert.match(css, /calc\(105px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /@media\(max-width:460px\)/);
  assert.match(css, /\.fex-cash-chart>span svg\{width:13px;height:13px/);
});
