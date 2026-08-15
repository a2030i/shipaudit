import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('home exposes both Lamha uploads with their latest upload timestamps', async () => {
  const [view, service] = await Promise.all([
    read('src/components/operations/FigmaCommandCenter.jsx'),
    read('src/lib/overviewService.js'),
  ]);
  assert.match(view, /ملف متاجر لمحة/);
  assert.match(view, /كشف حساب لمحة/);
  assert.match(view, /uploadDateLabel\(data\?\.lamhaUploads\?\.merchants\?\.uploadedAt\)/);
  assert.match(view, /uploadDateLabel\(data\?\.lamhaUploads\?\.balance\?\.uploadedAt\)/);
  assert.match(service, /from\('store_balance_snapshots'\)/);
  assert.match(service, /order\('uploaded_at', \{ ascending: false \}\)/);
});

test('home refreshes current-quarter VAT and displays the quarter bounds', async () => {
  const [page, view] = await Promise.all([
    read('src/pages/Overview.jsx'),
    read('src/components/operations/FigmaCommandCenter.jsx'),
  ]);
  assert.match(page, /loadCurrentVat\(\)/);
  assert.match(page, /Promise\.all\(/);
  assert.match(view, /vat\.from/);
  assert.match(view, /vat\.to/);
});
