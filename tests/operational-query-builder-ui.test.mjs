import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('customer finance opens with a flexible condition builder before executive summaries', async () => {
  const [page, queue] = await Promise.all([
    read('../src/pages/CustomerMoney.jsx'),
    read('../src/components/operations/AgingOperationsQueue.jsx'),
  ]);
  assert.ok(page.indexOf('<AgingOperationsQueue') < page.indexOf('customer-finance-command'));
  assert.match(queue, /ضع شروطك وأنشئ قائمة التنفيذ/);
  assert.match(queue, /أضف شرطًا…/);
  assert.match(page, /isWorklistMode \? 'قائمة التنفيذ'/);
  assert.match(page, /!isWorklistMode \? <>/);
  assert.match(queue, /CONDITION_ORDER/);
  assert.match(queue, /visible\.has\(key\)/);
  assert.match(queue, /مسح كل الشروط/);
});

test('worklist does not occupy the page with disabled bulk actions before selection', async () => {
  const resultSet = await readFile(new URL('../src/components/operations/AgingOperationsQueue.jsx', import.meta.url), 'utf8');
  assert.match(resultSet, /showActionsWhenEmpty: false/);
});

test('conditions cover finance, Lamha, collections and contact without a route per scenario', async () => {
  const queue = await read('../src/components/operations/AgingOperationsQueue.jsx');
  for (const condition of ['aging', 'minDays', 'minAmount', 'billing', 'wallet', 'invoices', 'status', 'owner', 'collection', 'promise', 'contact']) {
    assert.match(queue, new RegExp(`['"]${condition}['"]`));
  }
  assert.match(queue, /كلها تُطبّق معًا/);
  assert.match(queue, /results\.toLocaleString|totalRows\.toLocaleString/);
});

test('selected results expose direct actions and mobile keeps every action visible without horizontal clipping', async () => {
  const [queue, resultCss] = await Promise.all([
    read('../src/components/operations/AgingOperationsQueue.jsx'),
    read('../src/components/operations/operational-result-set.css'),
  ]);
  assert.match(queue, /label: 'إيقاف الحسابات'/);
  assert.match(queue, /label: 'حملة WhatsApp'/);
  assert.match(queue, /label: 'مراجعة IVR'/);
  assert.match(resultCss, /\.ors-bulk-bar>div\{grid-column:1\/-1;display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\);gap:5px;overflow:visible/);
});

test('numeric rules debounce typing before refreshing the live read model', async () => {
  const queue = await read('../src/components/operations/AgingOperationsQueue.jsx');
  assert.match(queue, /function NumericConditionInput/);
  assert.match(queue, /setTimeout\(\(\) => onCommit\(next\), 450\)/);
  assert.match(queue, /onBlur=\{flush\}/);
});
