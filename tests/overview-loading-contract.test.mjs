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
