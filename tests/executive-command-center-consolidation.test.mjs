import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('command center lazily adds existing profit, invoicing and cashflow reads in parallel', async () => {
  const page = await read('src/pages/Overview.jsx');
  assert.match(page, /Promise\.allSettled\(\[/);
  assert.match(page, /loadPnlSnapshots\(\)/);
  assert.match(page, /loadInvoicedVsCollected\(period\)/);
  assert.match(page, /loadCashflowForecast\(\{ horizonDays: 7, carriers \}\)/);
  assert.match(page, /requestIdleCallback/);
  assert.match(page, /executiveFinance=\{executiveFinance\}/);
  assert.match(page, /period === currentPeriod\(\).*loadCashflowForecast/);
});

test('first manager screen exposes financial direction with direct labels and drilldowns', async () => {
  const command = await read('src/components/operations/FigmaCommandCenter.jsx');
  for (const label of [
    'صافي الربح', 'فوترنا هذا الشهر', 'النقد والبنوك', 'القابل للتحصيل',
    'التزامات علينا', 'ضريبة', 'من الدخل إلى صافي الربح', 'رصيد السيولة خلال 7 أيام',
  ]) assert.match(command, new RegExp(label));
  assert.match(command, /function ProfitMicro/);
  assert.match(command, /function CashflowMicro/);
  assert.match(command, /<title id="fco-cashflow-title">توقع رصيد السيولة خلال سبعة أيام<\/title>/);
  assert.match(command, /navigate\('\/pnl'\)/);
  assert.match(command, /navigate\('\/forecast'\)/);
});

test('healthy zero-value automated signals remain quiet instead of becoming a card catalog', async () => {
  const command = await read('src/components/operations/FigmaCommandCenter.jsx');
  assert.match(command, /const showStopSignal = stopCount > 0/);
  assert.match(command, /const showDeductSignal = deductCount > 0/);
  assert.match(command, /const showNegativeSignal = negativeCount > 0/);
  assert.match(command, /const showZatcaSignal = zatcaCount > 0/);
  assert.match(command, /!hasAutomatedSignals \? <div className="fco-no-exceptions"/);
});

test('merchant activation drilldown uses the supported merchant decision workspace', async () => {
  const finance = await read('src/pages/FinanceExecutive.jsx');
  assert.match(finance, /\/merchants\?decision=activate&returnTo=%2Fworkspace%2Ffinance/);
  assert.doesNotMatch(finance, /\/customer-money\?decision=activate/);
});

test('executive microcharts keep a compact mobile sibling layout', async () => {
  const css = await read('src/components/operations/figma-command-center.css');
  assert.match(css, /\.fco-finance-insights/);
  assert.match(css, /\.fco-profit-micro/);
  assert.match(css, /\.fco-cashflow-micro/);
  assert.match(css, /@media\(max-width:760px\)\{\.fco-finance-insights\{grid-template-columns:1fr\}/);
});

test('customer growth and receivables stay primary while sources and routine operations are disclosed on demand', async () => {
  const command = await read('src/components/operations/FigmaCommandCenter.jsx');
  const movementIndex = command.indexOf('نمو العملاء النشطين');
  const agingIndex = command.indexOf('أعمار مديونيات العملاء');
  const secondaryIndex = command.indexOf('التشغيل والتكاملات');

  assert.ok(movementIndex > -1 && agingIndex > movementIndex);
  assert.ok(secondaryIndex > agingIndex);
  assert.match(command, /<details className="fco-operations-disclosure fco-secondary-disclosure">/);
  assert.doesNotMatch(command, /<section className="fco-panel fco-cash">/);

  const css = await read('src/components/operations/figma-command-center.css');
  assert.match(css, /\.fco-secondary-grid\{display:grid/);
  assert.match(css, /@media\(max-width:900px\)\{\.fco-secondary-grid\{grid-template-columns:1fr\}\}/);
});
