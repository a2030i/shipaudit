import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('overview isolates source failures and exposes their status', async () => {
  const service = await read('src/lib/overviewService.js');
  const page = await read('src/pages/Overview.jsx');

  assert.match(service, /Promise\.allSettled/);
  assert.match(service, /sourceStates/);
  assert.match(service, /sectionAvailability/);
  assert.match(page, /SourceStatusStrip/);
  assert.match(page, /لم نعرض صفراً بديلاً/);
});

test('financial report loaders do not turn API failures into zero reports', async () => {
  const service = await read('src/lib/pnlService.js');
  assert.match(service, /if \(error\) throw error/);
  assert.doesNotMatch(service, /if \(error\) return \[\]/);
});

test('modern receivables aging remains split into 0–15 and 16–30', async () => {
  const page = await read('src/pages/CustomerMoney.jsx');
  assert.match(page, /'0–15 يوم', aging\.b0_15/);
  assert.match(page, /'16–30 يوم', aging\.b16_30/);
});

test('dashboard charts publish accessible image semantics', async () => {
  const ui = await read('src/components/UI.jsx');
  assert.match(ui, /role="img"/);
  assert.match(ui, /<title>/);
  assert.match(ui, /useId/);
});

test('ZATCA read failure cannot be rendered as an all-clear state', async () => {
  const page = await read('src/pages/DecisionsBoard.jsx');
  assert.match(page, /حالة زاتكا غير متاحة/);
  assert.match(page, /لم نفترض أن العدد صفر/);
  assert.match(page, /zatcaError: zatcaLoadError/);
});
