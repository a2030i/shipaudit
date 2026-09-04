import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Batch 1 preserves customer deep links through canonical redirects', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /rawPath === '\/customers'/);
  assert.match(app, /workspace\/customers\?\$\{next\.toString\(\)\}/);
  assert.match(app, /rawPath === '\/collections' \|\| rawPath === '\/receivables'/);
  assert.match(app, /rawPath === '\/collections' \? 'queue' : 'internal'/);
  assert.match(app, /navigate\(`\/customer-money\?\$\{next\.toString\(\)\}`/);
  assert.match(app, /rawPath === '\/merchants'/);
  assert.match(app, /navigate\(`\/customer-360\?\$\{next\.toString\(\)\}`/);
});

test('Batch 1 collection workspace owns the header, breadcrumbs and responsive tabs', async () => {
  const hub = await read('src/pages/CollectionsHub.jsx');
  assert.match(hub, /Breadcrumbs, Page, PageHeader, Tabs/);
  assert.match(hub, /<Breadcrumbs/);
  assert.match(hub, /<PageHeader/);
  assert.match(hub, /<Tabs items=\{visibleTabs\}/);
  assert.match(hub, /<Cmp isActive=\{isActive && active\} embedded\/>/);
  assert.match(hub, /navigate\(`\/customer-money\?/);
});

test('Batch 1 operational pages use EnterpriseUI primitives instead of legacy UI markup', async () => {
  const paths = [
    'src/pages/CustomerMoney.jsx',
    'src/pages/Collections.jsx',
    'src/pages/CustomerReceivables.jsx',
    'src/components/CustomerContextDrawer.jsx',
    'src/components/operations/OperationalResultSet.jsx',
  ];
  const sources = await Promise.all(paths.map(read));
  for (const [index, source] of sources.entries()) {
    assert.doesNotMatch(source, /components\/UI\.jsx|\.\/UI\.jsx|\.\.\/UI\.jsx/, paths[index]);
    assert.doesNotMatch(source, /<table\b|<\/table>/, paths[index]);
  }
  assert.match(sources[0], /DataTable/);
  assert.match(sources[1], /DataTable/);
  assert.match(sources[2], /DataTable/);
  assert.match(sources[3], /<Drawer/);
});

test('Batch 1 uses shared states, semantic status and protected RTL number rendering', async () => {
  const [money, collections, receivables, drawer, ui] = await Promise.all([
    read('src/pages/CustomerMoney.jsx'),
    read('src/pages/Collections.jsx'),
    read('src/pages/CustomerReceivables.jsx'),
    read('src/components/CustomerContextDrawer.jsx'),
    read('src/design-system/EnterpriseUI.jsx'),
  ]);
  assert.match(money, /LoadingState as WorkspaceLoadingState/);
  assert.match(collections, /LoadingState/);
  assert.match(receivables, /ErrorState/);
  assert.match(receivables, /EmptyState as Empty/);
  assert.match(collections, /StatusBadge/);
  assert.match(drawer, /<Money value=/);
  assert.match(ui, /unicode-bidi:isolate|ds-money/);
  assert.match(money, /\\u2066/);
  assert.match(collections, /\\u2066/);
  assert.match(receivables, /\\u2066/);
});

test('Batch 1 destructive task cancellation uses the shared confirmation dialog', async () => {
  const collections = await read('src/pages/Collections.jsx');
  assert.doesNotMatch(collections, /window\.confirm|\bconfirm\(/);
  assert.match(collections, /title="تأكيد إلغاء مهمة التحصيل"/);
  assert.match(collections, /variant="danger"/);
  assert.match(collections, /cancelTask\(cancelTarget\.id/);
});

test('Batch 1 keeps row actions secondary and mobile filters inside shared primitives', async () => {
  const [collections, ui, responsive] = await Promise.all([
    read('src/pages/Collections.jsx'),
    read('src/design-system/EnterpriseUI.jsx'),
    read('src/design-system/responsive.css'),
  ]);
  assert.match(collections, /<OverflowMenu/);
  assert.match(collections, /label="فلترة مراحل التحصيل"/);
  assert.match(collections, /<Tabs/);
  assert.doesNotMatch(collections, /collections-work-queue__filters/);
  assert.match(ui, /export function OverflowMenu/);
  assert.match(ui, /role="menuitem"/);
  assert.match(responsive, /\.ds-overflow-menu>div button\{min-height:44px\}/);
});

test('the shared DataTable retains the full migration contract', async () => {
  const ui = await read('src/design-system/EnterpriseUI.jsx');
  for (const token of ['sort', 'onSort', 'loading', 'error', 'onRetry', 'hiddenColumnKeys', 'selection', 'empty']) {
    assert.match(ui, new RegExp(`\\b${token}\\b`), token);
  }
  assert.match(ui, /position:sticky|ds-table-shell/);
  assert.match(ui, /Pagination/);
  assert.match(ui, /aria-sort/);
  assert.match(ui, /aria-label=\{selection\.labelForRow/);
});
