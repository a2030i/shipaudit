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

test('overview applies the deadline to every dashboard source and VAT', async () => {
  const [service, page] = await Promise.all([
    readFile(new URL('../src/lib/overviewService.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/Overview.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(service, /tasks\.map\(task => \([\s\S]*withSourceTimeout\(Promise\.resolve\(\)\.then\(task\.run\), OVERVIEW_SOURCE_TIMEOUT_MS, task\.label\)/);
  assert.match(page, /withSourceTimeout\([\s\S]*loadCurrentVat\(\)[\s\S]*5_000/);
});

test('overview keeps the last readable source and refreshes quietly while active', async () => {
  const [service, page, commandCenter] = await Promise.all([
    readFile(new URL('../src/lib/overviewService.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/Overview.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/operations/FigmaCommandCenter.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(service, /const overviewSourceCache = new Map\(\)/);
  assert.match(service, /fromCache:\s*true/);
  assert.match(service, /result\?\.fromCache \? 'stale'/);
  assert.match(service, /تعذرت القراءة الحالية؛ تُعرض آخر قراءة ناجحة/);
  assert.match(service, /overviewResultCache\.set\(overviewCacheKey\(cacheScope, thisPeriod\), overview\)/);
  assert.match(service, /overviewCacheKey\(cacheScope, thisPeriod, task\.key\)/);
  assert.match(page, /getCachedOverview\(period, overviewCacheScope\)/);
  assert.match(page, /loadOverview\(\{ period, topN: 5, cacheScope: overviewCacheScope \}\)/);
  assert.match(page, /window\.addEventListener\('focus', refreshIfStale\)/);
  assert.match(page, /document\.addEventListener\('visibilitychange', refreshIfStale\)/);
  assert.match(page, /window\.setInterval\(refreshIfStale, 300_000\)/);
  assert.match(commandCenter, /آخر فحص \{checkedDateLabel\(data\?\.loadedAt\)\}/);
  assert.match(commandCenter, /needsResolution \? resolveAction : action/);
});
