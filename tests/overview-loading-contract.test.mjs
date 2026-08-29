import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  OVERVIEW_SOURCE_TIMEOUT_MS,
  withSourceTimeout,
} from '../src/lib/overviewService.js';

test('overview source reads have a finite shared deadline', async () => {
  assert.equal(OVERVIEW_SOURCE_TIMEOUT_MS, 8_000);

  const startedAt = Date.now();
  await assert.rejects(
    withSourceTimeout(new Promise(() => {}), 20, 'مصدر تجريبي'),
    /انتهت مهلة قراءة مصدر تجريبي/,
  );
  assert.ok(Date.now() - startedAt < 500, 'timeout helper should release the page promptly');
});

test('overview applies a deadline to lite, lazy, core, legacy sources and VAT', async () => {
  const [service, page] = await Promise.all([
    readFile(new URL('../src/lib/overviewService.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/Overview.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(service, /tasks\.map\(task => \([\s\S]*withSourceTimeout\(Promise\.resolve\(\)\.then\(task\.run\), OVERVIEW_SOURCE_TIMEOUT_MS, task\.label\)/);
  assert.match(service, /client\.rpc\('overview_core_lite'[\s\S]*OVERVIEW_SOURCE_TIMEOUT_MS/);
  assert.match(service, /client\.rpc\('overview_merchant_pulse_lite'[\s\S]*OVERVIEW_SOURCE_TIMEOUT_MS/);
  assert.match(service, /client\.rpc\('overview_cash_lite'\), OVERVIEW_SOURCE_TIMEOUT_MS/);
  assert.match(service, /loadCurrentVat\(\), 5_000/);
});

test('overview keeps the current readable page and refreshes while active', async () => {
  const [page, commandCenter] = await Promise.all([
    readFile(new URL('../src/pages/Overview.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/operations/FigmaCommandCenter.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(page, /const hasCurrentData = data\?\.period === period/);
  assert.match(page, /if \(!hasCurrentData && loadError\)/);
  assert.match(page, /window\.addEventListener\('focus', refreshIfStale\)/);
  assert.match(page, /document\.addEventListener\('visibilitychange', onVisibilityChange\)/);
  assert.match(page, /window\.setInterval\(refreshIfStale, 300_000\)/);
  assert.match(commandCenter, /آخر تحديث/);
  assert.match(commandCenter, /للعرض فقط · يُعاد التحقق داخل النتائج/);
});
