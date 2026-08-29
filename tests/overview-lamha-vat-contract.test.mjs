import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('home separates the Lamha API mirror from optional Excel uploads', async () => {
  const [view, service] = await Promise.all([
    read('src/components/operations/FigmaCommandCenter.jsx'),
    read('src/lib/overviewService.js'),
  ]);
  assert.match(view, /دليل المتاجر من Lamha API/);
  assert.match(view, /إثراء المتاجر من Excel/);
  assert.match(view, /كشف حساب Lamha/);
  assert.match(view, /syncDateLabel\(data\?\.lamhaUploads\?\.merchants\?\.apiSyncedAt/);
  assert.match(view, /excelUploadedAt/);
  assert.match(view, /excelFileName/);
  assert.match(view, /uploadDateLabel\(data\?\.lamhaUploads\?\.balance\?\.uploadedAt\)/);
  assert.match(view, /accounting-cycle\?period=\$\{period\}&stage=lamha_sources/);
  assert.match(view, /Excel للحقول غير المتاحة في API · المرحلة 4/);
  assert.match(service, /from\('accounting_cycle_events'\)/);
  assert.match(service, /lamha_merchants_excel/);
  assert.match(service, /apiSyncedAt/);
  assert.match(service, /from\('store_balance_snapshots'\)/);
  assert.match(service, /order\('uploaded_at', \{ ascending: false \}\)/);
});

test('global Lamha action opens the real stage-four upload workspace', async () => {
  const launcher = await read('src/components/QuickActionLauncher.jsx');
  assert.match(launcher, /path: '\/accounting-cycle\?stage=lamha_sources'/);
  assert.doesNotMatch(launcher, /path: '\/accounting-cycle\?action=lamha'/);
});

test('home refreshes current-quarter VAT and displays the quarter bounds', async () => {
  const [service, view] = await Promise.all([
    read('src/lib/overviewService.js'),
    read('src/components/operations/FigmaCommandCenter.jsx'),
  ]);
  assert.match(service, /loadOverviewLite/);
  assert.match(service, /vat: mapCoreVat\(payload\.vat\)/);
  assert.match(service, /loadCurrentVat\(\)/);
  assert.match(view, /vat\.from/);
  assert.match(view, /vat\.to/);
});
