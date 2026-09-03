import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('home presents Lamha directory and statement as automated API sources', async () => {
  const [view, service] = await Promise.all([
    read('src/components/operations/FigmaCommandCenter.jsx'),
    read('src/lib/overviewService.js'),
  ]);
  assert.match(view, /دليل المتاجر من Lamha API/);
  assert.match(view, /كشف الحساب من Lamha API/);
  assert.match(view, /syncDateLabel\(data\?\.lamhaUploads\?\.merchants\?\.apiSyncedAt/);
  assert.match(view, /syncDateLabel\(data\?\.lamhaUploads\?\.balance\?\.uploadedAt\)/);
  assert.doesNotMatch(view, /إثراء المتاجر من Excel غير مرفوع/);
  assert.doesNotMatch(view, /merchantExcelMissing/);
  assert.match(service, /from\('accounting_cycle_events'\)/);
  assert.match(service, /apiSyncedAt/);
  assert.match(service, /from\('store_balance_snapshots'\)/);
  assert.match(service, /order\('uploaded_at', \{ ascending: false \}\)/);
});

test('global Lamha action opens integration monitoring instead of a manual upload', async () => {
  const launcher = await read('src/components/QuickActionLauncher.jsx');
  assert.match(launcher, /title: 'مراقبة مزامنة لمحة'/);
  assert.match(launcher, /path: '\/operations'/);
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
