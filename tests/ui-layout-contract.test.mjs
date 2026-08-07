import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('final workspace layout layer is loaded before the Safari scroll contract', async () => {
  const main = await read('src/main.jsx');
  const layoutIndex = main.indexOf("import './workspace-layout.css'");
  const scrollIndex = main.indexOf("import './mobile-scroll.css'");
  assert.ok(layoutIndex > -1, 'workspace layout stylesheet must be imported');
  assert.ok(scrollIndex > layoutIndex, 'mobile scroll contract must remain the final stylesheet');
});

test('mobile PageSlot uses normal flow and a real safe-area end spacer', async () => {
  const app = await read('src/App.jsx');
  const css = await read('src/mobile-scroll.css');

  assert.match(app, /scroll && <div className="page-slot-scroll-end"/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.page-slot\s*\{[\s\S]*display:\s*block\s*!important/);
  assert.match(css, /\.page-slot\s*\{[\s\S]*overflow-y:\s*auto\s*!important/);
  assert.match(css, /\.page-slot-scroll-end\s*\{[\s\S]*min-height:\s*calc\(112px \+ env\(safe-area-inset-bottom, 0px\)\)/);
});

test('mobile workspace removes repeated headings and keeps compact context', async () => {
  const css = await read('src/workspace-layout.css');
  assert.match(css, /\.workspace-switcher__copy\s*\{\s*display:\s*none;/s);
  assert.match(css, /\.workspace-context-copy p[\s\S]*display:\s*none;/);
  assert.match(css, /\.workspace-context-outcome\s*\{[\s\S]*grid-column:\s*2;/);
});

test('mobile data tables have explicit card, compact and overflow strategies', async () => {
  const css = await read('src/workspace-layout.css');
  assert.match(css, /table\.m-cards tr[\s\S]*content-visibility:\s*auto;/);
  assert.match(css, /table:not\(\.m-cards\):not\(\.m-compact\)[\s\S]*overflow-x:\s*auto;/);
  assert.match(css, /table\.m-compact th[\s\S]*padding:/);
});

test('shared KPI summaries expose stable responsive hooks', async () => {
  const ui = await read('src/components/UI.jsx');
  const css = await read('src/workspace-layout.css');

  assert.match(ui, /page-summary page-summary--/);
  assert.match(ui, /page-summary__side/);
  assert.match(ui, /page-summary-stat__value/);
  assert.match(css, /\.page-summary__side\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,/);
  assert.match(css, /\.page-summary-stat__value\s*\{[\s\S]*white-space:\s*normal\s*!important/);
});

test('mobile data confidence remains actionable without a long explainer', async () => {
  const component = await read('src/components/DataConfidenceBar.jsx');
  const css = await read('src/workspace-layout.css');

  assert.match(component, /className="data-confidence__detail"/);
  assert.match(component, /className="data-confidence__actions"/);
  assert.match(css, /\.data-confidence__detail\s*\{[\s\S]*-webkit-line-clamp:\s*1/);
  assert.match(css, /\.data-confidence__actions\s*\{[\s\S]*repeat\(3,/);
});

test('permissions modal has one scroll region and a persistent action bar', async () => {
  const modal = await read('src/components/UI.jsx');
  const employees = await read('src/pages/EmployeeManager.jsx');
  const css = await read('src/workspace-layout.css');

  assert.match(modal, /bodyClassName = ''/);
  assert.match(employees, /className="permissions-dialog"/);
  assert.match(employees, /className="permission-modal-list"/);
  assert.match(css, /\.permissions-dialog \.modal-body\s*\{[\s\S]*overflow:\s*hidden/);
  assert.match(css, /\.permission-modal-list\s*\{[\s\S]*overflow-y:\s*auto/);
});

test('dense financial actions expose a named secondary action menu', async () => {
  const settlements = await read('src/pages/CodSettlements.jsx');
  const css = await read('src/workspace-layout.css');

  assert.match(settlements, /page-action-menu\$\{moreActionsOpen/);
  assert.match(settlements, /إجراءات إضافية/);
  assert.match(settlements, /تصدير المتبقي لكل الناقلين/);
  assert.match(css, /\.page-action-menu__panel\s*\{/);
});

test('contracts use the mobile card table contract without hiding pricing fields', async () => {
  const contracts = await read('src/pages/ContractsOverview.jsx');

  assert.match(contracts, /className="m-cards contracts-overview-table"/);
  assert.match(contracts, /data-label="السعر الأساسي"/);
  assert.match(contracts, /data-label="كل كيلو زائد"/);
  assert.match(contracts, /data-label="رسوم COD"/);
  assert.match(contracts, /data-label="الحالة"/);
});

test('carrier hub owns one summary surface with navigation actions', async () => {
  const hub = await read('src/pages/CarriersHub.jsx');

  assert.doesNotMatch(hub, /PageHeader/);
  assert.match(hub, /title="شركات الشحن — كشف موحّد"/);
  assert.match(hub, /فتح الوارد/);
  assert.match(hub, /إدارة الشركات/);
  assert.match(hub, /تحديث الحالة/);
});

test('mobile page filters can share the action row with their primary action', async () => {
  const css = await read('src/workspace-layout.css');

  assert.match(css, /\.page-hero-actions > div:not\(\.ui-field\):not\(\.page-action-menu\)/);
  assert.match(css, /\.page-hero-actions > \.ui-field\s*\{[\s\S]*min-width:\s*0\s*!important/);
});

test('active work areas own navigation and expose their child pages in the sidebar', async () => {
  const app = await read('src/App.jsx');
  const navigation = await read('src/lib/navigation.js');
  const workspaceFiles = [
    'src/pages/CarriersWorkspace.jsx',
    'src/pages/CollectionsHub.jsx',
    'src/pages/MoneyHub.jsx',
    'src/pages/SalesHub.jsx',
    'src/pages/WhatsAppSettings.jsx',
    'src/components/CenterWorkspace.jsx',
  ];
  const workspaces = await Promise.all(workspaceFiles.map(read));

  assert.match(app, /className="nav-tree-children"/);
  assert.match(app, /collapsed \|\| sectionHasActive \|\| !collapsedSecs\.has\(sec\.id\)/);
  assert.match(app, /tabId: 'performance'/);
  assert.match(app, /tabId: 'pipeline'/);
  assert.match(app, /tabId: 'settings'.*crm\.manage_statuses/);
  assert.match(app, /tabId: 'exports'.*legacy: '\/internal-exports'/);
  for (const source of workspaces) assert.doesNotMatch(source, /<WorkspaceTabs/);

  assert.match(navigation, /'accounting-cycle':\s*\{[^}]*section: 'shipping'[^}]*group: 'monthly_cycle'/);
  assert.doesNotMatch(navigation, /'accounting-cycle':\s*\{[^}]*group: 'cash_ops'/);
  assert.match(navigation, /id: 'cash_ops', label: 'البنوك والسيولة'/);
});
