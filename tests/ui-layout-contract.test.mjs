import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('final workspace layout layer is loaded before the Safari scroll contract', async () => {
  const main = await read('src/main.jsx');
  const layoutIndex = main.indexOf("import './workspace-layout.css'");
  const scrollIndex = main.indexOf("import './mobile-scroll.css'");
  const finalStyleIndex = Math.max(
    ...[...main.matchAll(/import '\.\/(?:[^']+)\.css'/g)].map(match => match.index),
  );
  assert.ok(layoutIndex > -1, 'workspace layout stylesheet must be imported');
  assert.ok(scrollIndex > layoutIndex, 'mobile scroll contract must remain the final stylesheet');
  assert.equal(scrollIndex, finalStyleIndex, 'mobile scroll contract must be the last stylesheet in the cascade');
});

test('mobile PageSlot uses normal flow and a real safe-area end spacer', async () => {
  const app = await read('src/App.jsx');
  const css = await read('src/mobile-scroll.css');

  assert.match(app, /scroll && <div className="page-slot-scroll-end"/);
  assert.doesNotMatch(app, /const frozen = useRef\(children\)/);
  assert.match(app, /const content = children/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.page-slot\s*\{[\s\S]*display:\s*block\s*!important/);
  assert.match(css, /\.page-slot\s*\{[\s\S]*overflow-y:\s*auto\s*!important/);
  assert.match(css, /--mobile-page-end-space:\s*calc\(144px \+ env\(safe-area-inset-bottom, 0px\)\)/);
  assert.match(css, /\.page-slot-scroll-end\s*\{[\s\S]*min-height:\s*var\(--mobile-page-end-space\)/);
  assert.match(css, /#root \.app-layout\.primary-collapsed[\s\S]*display:\s*block\s*!important/);
  assert.match(css, /#root \.app-layout,[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 0\s*!important/);
  assert.match(css, /--sa-primary-rail:\s*0px/);
  assert.match(css, /\.app-main,[\s\S]*\.page-content,[\s\S]*\.page-slot\s*\{[\s\S]*inline-size:\s*100%\s*!important/);
  assert.match(css, /\.app-layout > \.sidebar,[\s\S]*position:\s*fixed\s*!important/);
  assert.doesNotMatch(css, /100vw/);
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
  assert.match(component, /viewUpdatedAt/);
  assert.match(component, /تحميل العرض:/);
  assert.match(component, /مزامنة المصدر:/);
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
  assert.doesNotMatch(employees, /permission-modal-list" style=\{\{[^}]*overflowY/);
  assert.match(css, /\.permissions-dialog \.modal-body\s*\{[\s\S]*overflow:\s*hidden/);
  assert.match(css, /\.permission-modal-list\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.permissions-dialog \.modal-body\s*\{[\s\S]*overflow-y:\s*auto\s*!important/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.permission-modal-list\s*\{[\s\S]*overflow:\s*visible\s*!important/);
  assert.match(css, /\.permission-modal-footer\s*\{[\s\S]*position:\s*sticky/);
});

test('visual system v6 keeps one navigation shell, calm canvas and mobile drawer contract', async () => {
  const app = await read('src/App.jsx');
  const css = await read('src/workspace-layout.css');

  assert.match(css, /System-wide visual layer/);
  assert.match(css, /--shell-primary-width:\s*176px/);
  assert.match(css, /single-level information architecture/);
  assert.match(css, /\.app-layout\s*\{[\s\S]*grid-template-columns:\s*var\(--shell-primary-width\) minmax\(0, 1fr\)\s*!important/);
  assert.match(css, /\.context-sidebar,[\s\S]*display:\s*none\s*!important/);
  assert.match(css, /\.primary-center-item\.active\s*\{[\s\S]*inset -3px 0 0/);
  assert.match(css, /\.workspace-page\s*\{[\s\S]*max-width:\s*1540px/);
  assert.match(css, /\.page-summary--dark\s*\{[\s\S]*linear-gradient/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.modal-panel\s*\{[\s\S]*border-radius:\s*18px 18px 0 0/);
  assert.match(app, /sidebar-brand-logo--desktop/);
  assert.match(app, /sidebar-brand-logo--mobile/);
});

test('primary navigation rail leaves center labels comfortably readable', async () => {
  const shell = await readFile(new URL('../src/shipaudit-os-v2.css', import.meta.url), 'utf8');
  assert.match(shell, /--sa-primary-rail:\s*124px/);
  assert.match(shell, /max-width:\s*108px\s*!important/);
  assert.match(shell, /--sa-primary-rail:\s*100px;/);
  assert.doesNotMatch(shell, /--sa-context-rail/);
  assert.match(shell, /\.app-layout\.primary-collapsed\s*\{[\s\S]*--sa-primary-rail:\s*76px/);
  assert.match(shell, /width:\s*min\(86vw,\s*340px\)\s*!important/);
});

test('mobile drawer keeps the white Lamha logo on a connected navy header', async () => {
  const css = await read('src/product-shell.css');

  assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.app-layout > \.sidebar \.sidebar-logo[\s\S]*rgba\(4, 31, 68, \.96\) !important/);
  assert.match(css, /\.app-layout > \.sidebar \.sidebar-brand-logo--mobile[\s\S]*display:\s*inline-flex\s*!important/);
  assert.match(css, /\.app-layout > \.sidebar \.sidebar-mobile-title[\s\S]*color:\s*rgba\(255, 255, 255, \.9\)\s*!important/);
  assert.match(css, /\.app-layout > \.sidebar \.sidebar-close[\s\S]*background:\s*rgba\(255, 255, 255, \.08\)/);
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
  assert.match(hub, /title="شركات الشحن"/);
  assert.match(hub, /\+ رفع فاتورة شركة شحن/);
  assert.match(hub, /فتح الوارد/);
  assert.match(hub, /إدارة الشركات/);
  assert.match(hub, /تحديث الحالة/);
});

test('mobile page filters can share the action row with their primary action', async () => {
  const css = await read('src/workspace-layout.css');

  assert.match(css, /\.page-hero-actions > div:not\(\.ui-field\):not\(\.page-action-menu\)/);
  assert.match(css, /\.page-hero-actions > \.ui-field\s*\{[\s\S]*min-width:\s*0\s*!important/);
});

test('overview month controls stay compact instead of inheriting the generic action grid', async () => {
  const overview = await read('src/pages/Overview.jsx');
  const css = await read('src/workspace-layout.css');

  assert.match(overview, /className="overview-period-actions"/);
  assert.match(overview, /className="overview-period-actions__navigation"/);
  assert.match(css, /\.overview-page > \.page-hero-band\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  assert.match(css, /\.overview-page \.overview-period-actions\s*\{[\s\S]*display:\s*flex\s*!important/);
  assert.match(css, /\.overview-period-actions__navigation\s*\{[\s\S]*display:\s*flex\s*!important/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.overview-page \.overview-period-actions\s*\{[\s\S]*grid-template-columns:\s*auto\s+repeat\(2,/);
});

test('overview keeps customer decisions and customer debt ahead of carrier-only analysis', async () => {
  const overview = await read('src/pages/Overview.jsx');
  const css = await read('src/workspace-layout.css');

  assert.match(overview, /<CustomerDecisionBoard[\s\S]*?<CustomerPortfolioFocus[\s\S]*?<details id="carrier-analysis"/);
  assert.match(overview, /function CustomerPortfolioFocus/);
  assert.match(css, /\.overview-secondary-analysis\s*\{/);
  assert.match(css, /\.overview-secondary-analysis > summary/);
  assert.match(css, /\.overview-customer-focus\s*\{/);
});

test('overview does not use carrier-only missions ahead of the customer command center', async () => {
  const overview = await read('src/pages/Overview.jsx');
  const operationStart = overview.indexOf('function OperationsCommand');
  const operationEnd = overview.indexOf('function CashBridge');
  const operation = overview.slice(operationStart, operationEnd);

  assert.doesNotMatch(operation, /title:\s*'COD عند شركات الشحن'/);
  assert.doesNotMatch(operation, /title:\s*'ذمم ناقلين قديمة'/);
  assert.match(overview, /<CustomerPortfolioFocus[\s\S]*?<OperationsCommand/);
});

test('store activation hero keeps readable contrast and a compact mobile metric grid', async () => {
  const page = await read('src/pages/StoreActivation.jsx');
  const css = await read('src/pages/StoreActivation.css');

  assert.match(page, /className="activation-hero-card"/);
  assert.match(page, /className="activation-hero-stats"/);
  assert.match(page, /activation-hero-stat-label/);
  assert.match(css, /\.activation-hero-card\.ui-card\s*\{[\s\S]*background:[\s\S]*!important/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.activation-hero-stats\s*\{[\s\S]*repeat\(2,/);
  assert.match(css, /\.activation-hero-stat--wide\s*\{[\s\S]*grid-column:\s*1 \/ -1\s*!important/);
});

test('customer debt cards bridge to an owned collection task and next action', async () => {
  const money = await read('src/pages/CustomerMoney.jsx');
  const queue = await read('src/pages/Collections.jsx');
  const css = await read('src/workspace-layout.css');

  assert.match(money, /listTasks\(\)/);
  assert.match(money, /المسؤول:/);
  assert.match(money, /الإجراء التالي:/);
  assert.match(money, /new URLSearchParams\(\{ view: 'queue', search: c\.name \}\)/);
  assert.match(queue, /focusedCustomer/);
  assert.match(queue, /مهمة العميل:/);
  assert.match(queue, /عرض كل المهام/);
  assert.match(css, /\.customer-collection-work\s*\{/);
});

test.skip('legacy four-center navigation contract', async () => {
  const app = await read('src/App.jsx');
  const navigation = await read('src/lib/navigation.js');
  const css = await read('src/workspace-layout.css');
  const shell = await read('src/product-shell.css');
  const workspaceFiles = [
    'src/pages/CarriersWorkspace.jsx',
    'src/pages/CollectionsHub.jsx',
    'src/pages/MoneyHub.jsx',
    'src/pages/SalesHub.jsx',
    'src/pages/WhatsAppSettings.jsx',
    'src/components/CenterWorkspace.jsx',
  ];
  const workspaces = await Promise.all(workspaceFiles.map(read));

  assert.match(app, /<aside className="context-sidebar"/);
  assert.match(app, /className="mobile-context-picker"/);
  assert.doesNotMatch(app, /className="context-mobile-nav"/);
  assert.doesNotMatch(app, /mobileNavLevel/);
  assert.doesNotMatch(app, /sidebarRowsFor/);
  assert.match(app, /className="primary-center-nav"/);
  assert.match(app, /className={`primary-center-item/);
  assert.doesNotMatch(app, /<CenterLanding/);
  assert.match(app, /onClick=\{\(\) => goto\(items\[0\]\?\.path \|\| sec\.path\)\}/);
  assert.match(app, /<QuickActionLauncher/);
  assert.match(app, /className="topbar-quick-action"/);
  assert.match(app, /tabId: 'performance'/);
  assert.match(workspaces[0], /id: 'pipeline'/);
  assert.doesNotMatch(app, /label: 'صفقات ومواعيد المبيعات'/);
  assert.doesNotMatch(app, /tabId: 'settings'.*crm\.manage_statuses/);
  assert.match(app, /tabId: 'exports'.*legacy: '\/internal-exports'/);
  assert.match(app, /id: 'app-settings'[\s\S]*tabId: 'employees'[\s\S]*legacy: '\/employees'/);
  assert.match(app, /id: 'app-settings'[\s\S]*tabId: 'carriers'[\s\S]*legacy: '\/carriers'/);
  assert.match(app, /id: 'app-settings'[\s\S]*tabId: 'contracts'[\s\S]*legacy: '\/contracts'/);
  for (const source of workspaces) assert.doesNotMatch(source, /<WorkspaceTabs/);
  assert.match(shell, /\.app-layout\.has-context\s*\{[\s\S]*grid-template-areas:\s*"main context primary"/);
  assert.match(shell, /\.context-sidebar\s*\{/);
  assert.match(shell, /@media \(max-width:\s*768px\)[\s\S]*\.mobile-context-picker\s*\{/);
  assert.match(css, /\.quick-action-backdrop\s*\{/);

  assert.match(navigation, /id: 'finance',[\s\S]*?label: 'العمليات المالية'/);
  assert.match(navigation, /id: 'sales',[\s\S]*?label: 'المبيعات'/);
  assert.match(navigation, /id: 'support',[\s\S]*?label: 'خدمة العملاء'/);
  assert.match(navigation, /id: 'admin',[\s\S]*?label: 'إدارة النظام'/);
  assert.doesNotMatch(navigation, /id: '(customers|shipping|reports|settings)'/);
  assert.match(navigation, /overview:\s*\{[^}]*section: 'finance'[^}]*order: 10[^}]*pinned: false/);
  assert.match(navigation, /'collections-hub':\s*\{[^}]*label: 'العملاء والذمم'[^}]*section: 'finance'[^}]*order: 20/);
  assert.match(navigation, /fulfillment:\s*\{[^}]*label: 'فواتير العملاء'[^}]*section: 'finance'[^}]*order: 30/);
  assert.match(navigation, /hub:\s*\{[^}]*label: 'الناقلون والتكاليف'[^}]*section: 'finance'[^}]*order: 40/);
  assert.match(navigation, /money:\s*\{[^}]*label: 'الدفع عند الاستلام والتسويات'[^}]*section: 'finance'[^}]*order: 50/);
  assert.match(navigation, /bank:\s*\{[^}]*label: 'البنوك والمطابقات'[^}]*section: 'finance'[^}]*order: 60/);
  assert.match(navigation, /'accounting-cycle':\s*\{[^}]*label: 'الإقفال المحاسبي'[^}]*section: 'finance'[^}]*order: 70/);
  assert.match(navigation, /reports:\s*\{[^}]*label: 'التقارير والرقابة'[^}]*section: 'finance'[^}]*order: 80/);
  assert.match(navigation, /'hatif-settings':\s*\{[^}]*label: 'القنوات وهاتف'[^}]*section: 'admin'/);
  assert.doesNotMatch(app, /className="context-subnav"/);
  assert.doesNotMatch(app, /className="context-subnav accounting-stage-nav"/);
  assert.match(app, /id: 'bank',\s+path: '\/bank'[^\n]*permKey: 'bank\.view'/);
  assert.match(app, /permissionNav\.find\(item => location\.pathname === item\.path\)\s*\|\|\s*permissionNav\.find\(item => activeFor\(item\)\)/);
  assert.match(navigation, /employees:\s*\{[^}]*visible: true/);
  assert.doesNotMatch(navigation, /carriers:\s*\{[^}]*visible: true/);
  assert.doesNotMatch(navigation, /contracts:\s*\{[^}]*visible: true/);
  assert.match(navigation, /'app-settings':\s*\{[^}]*visible: true/);
  assert.match(navigation, /id: 'finance',[\s\S]*?path: '\/workspace\/finance'/);
  assert.match(navigation, /id: 'sales',[\s\S]*?path: '\/workspace\/sales'/);
  assert.match(navigation, /id: 'support',[\s\S]*?path: '\/workspace\/support'/);
  assert.match(navigation, /id: 'admin',[\s\S]*?path: '\/workspace\/admin'/);
  assert.match(app, /id: 'hatif-settings'[^\n]*path: '\/settings\/hatif'[^\n]*permKey: 'whatsapp\.configure'/);
  assert.match(app, /pathname==='\/settings\/hatif'[\s\S]*<WhatsAppSettings[^>]*settingsOnly/);
  const reportRouteBlock = app.slice(
    app.indexOf("{ id: 'reports'"),
    app.indexOf("{ id: 'monthly-report'"),
  );
  assert.doesNotMatch(reportRouteBlock, /legacy: '\/(uploads|integrity|activity-log)'/);
  const operationsRouteBlock = app.slice(
    app.indexOf("{ id: 'operations'"),
    app.indexOf('// Each section carries'),
  );
  assert.match(operationsRouteBlock, /legacy: '\/uploads'/);
  assert.match(operationsRouteBlock, /legacy: '\/integrity'/);
  assert.match(operationsRouteBlock, /legacy: '\/activity-log'/);
  const whatsappRouteBlock = app.slice(
    app.indexOf("{ id: 'whatsapp-settings'"),
    app.indexOf('// ── الإعدادات الفعلية'),
  );
  assert.doesNotMatch(whatsappRouteBlock, /tabId: 'settings'/);
});

test('stable work areas use one seven-entry rail and permission-aware center launchpads', async () => {
  const app = await read('src/App.jsx');
  const navigation = await read('src/lib/navigation.js');
  const center = await read('src/components/CenterLanding.jsx');
  const shell = await read('src/shipaudit-os-v2.css');

  for (const id of ['customers', 'sales', 'finance', 'shipping', 'reports', 'settings']) {
    assert.match(navigation, new RegExp(`id: '${id}'`));
  }
  for (const id of [
    'hub', 'platform-carriers', 'accounting-cycle', 'customer-watch',
    'collections-hub', 'bank', 'zoho-data', 'operations', 'uploads',
    'hatif-settings', 'carriers', 'contracts', 'app-settings',
  ]) {
    assert.match(navigation, new RegExp(`(?:^|\\n)\\s*'?${id}'?:\\s*\\{[^}]*visible: true`));
  }

  assert.doesNotMatch(app, /<aside className="context-sidebar"/);
  assert.doesNotMatch(app, /className="mobile-context-picker"/);
  assert.doesNotMatch(app, /className="context-subnav"/);
  assert.match(app, /<CenterLanding/);
  assert.match(app, /onClick=\{\(\) => goto\(sec\.path\)\}/);
  assert.match(app, /visibleSubTabsFor/);
  assert.match(center, /destinationsFor/);
  assert.match(center, /subTabPath\(item, tab\)/);
  assert.match(navigation, /decisions:\s*\{[^}]*visible: false/);
  assert.doesNotMatch(shell, /--sa-context-rail/);
  assert.doesNotMatch(shell, /grid-template-areas:\s*"main context primary"/);
  assert.match(app, /tabId: 'segments'/);
  assert.match(app, /tabId: 'ivr'/);
  assert.match(app, /id: 'zoho-data'[\s\S]*tabId: 'banks'/);
  assert.match(app, /id: 'bank',\s+path: '\/bank'[^\n]*permKey: 'bank\.view'/);
  assert.match(app, /id: 'hatif-settings'[^\n]*path: '\/settings\/hatif'[^\n]*permKey: 'whatsapp\.configure'/);
});

test('phase one exposes approved workspaces without removing legacy routes', async () => {
  const app = await read('src/App.jsx');
  const navigation = await read('src/lib/navigation.js');
  const landing = await read('src/components/CenterLanding.jsx');
  const tabs = await read('src/components/WorkspaceTabs.jsx');
  const sales = await read('src/pages/SalesHub.jsx');
  const collections = await read('src/pages/CollectionsHub.jsx');
  const cash = await read('src/pages/MoneyHub.jsx');
  const customers = await read('src/pages/CustomerWatch.jsx');

  assert.match(navigation, /export const CENTER_WORKSPACES/);
  assert.match(navigation, /label: 'دليل العملاء والمتاجر'/);
  assert.match(navigation, /label: 'النقد والتسويات'/);
  assert.match(navigation, /id: 'cash-settlements'[\s\S]*memberIds: \['money', 'bank'\]/);
  assert.match(landing, /workspaceDestinationsFor/);
  assert.match(landing, /طرق عرض رئيسية متاحة حسب صلاحياتك/);
  assert.match(landing, />طريقة العرض</);
  assert.match(tabs, /selectorLabel = 'القسم'/);

  for (const source of [sales, collections]) {
    assert.match(source, /<WorkspaceTabs/);
    assert.match(source, /params\.set\('view', next\)/);
    assert.match(source, /params\.get\('view'\) \|\| params\.get\('tab'\)/);
  }
  assert.match(cash, /<WorkspaceTabs/);
  assert.match(cash, /params\.set\('tab', next\)/);
  assert.match(cash, /id: 'bank'/);
  assert.match(cash, /id: 'cod'/);
  assert.match(cash, /id: 'payments'/);
  assert.match(cash, /id: 'unclassified'/);
  assert.match(cash, /defaultSavedClass: 'unclassified'/);
  assert.match(customers, /title="دليل العملاء والمتاجر"/);
  assert.match(customers, /params\.set\('customer', identity\)/);

  for (const path of ['/cod-settlements', '/payments', '/bank', '/collections', '/legal', '/receivables', '/retargeting', '/hatif-leads', '/segments', '/merchants']) {
    assert.ok(app.includes(`'${path}'`), `legacy path ${path} must remain registered`);
  }
  assert.doesNotMatch(app, /label: 'القرارات', icon: Gauge/);
  assert.doesNotMatch(app, /label: 'التحصيل',\s+icon: HandCoins/);
});

test('phase one KPI and filter contracts expose source truth and URL state', async () => {
  const commandCenter = await read('src/components/operations/FigmaCommandCenter.jsx');
  const customerMoney = await read('src/pages/CustomerMoney.jsx');
  const bank = await read('src/pages/BankStatement.jsx');
  const css = await read('src/workspace-layout.css');

  assert.match(commandCenter, /source="Zoho Books"/);
  assert.match(commandCenter, /آخر تحديث/);
  assert.match(commandCenter, /تعذرت القراءة؛ لم نعرض صفراً بديلاً/);
  assert.match(customerMoney, /searchParams\.get\('aging'\)/);
  assert.match(customerMoney, /params\.set\('aging'/);
  assert.match(bank, /defaultSavedClass = 'all'/);
  assert.match(bank, /isActive && view === 'saved'/);
  assert.match(css, /\.workspace-filter-bar\s*\{/);
});

test('phase two groups operations reports and admin into approved workspaces', async () => {
  const app = await read('src/App.jsx');
  const navigation = await read('src/lib/navigation.js');
  const centerWorkspace = await read('src/components/CenterWorkspace.jsx');

  assert.match(navigation, /shipping:\s*\[[\s\S]*label: 'شركات الشحن'[\s\S]*label: 'المهام والاستثناءات'[\s\S]*label: 'دورة الشهر'[\s\S]*label: 'فوترة الخدمات والأوزان'/);
  assert.match(navigation, /reports:\s*\[[\s\S]*label: 'مكتبة التقارير'[\s\S]*label: 'أداء التحصيل'[\s\S]*label: 'أداء شركات الشحن'[\s\S]*label: 'التواصل والحملات'[\s\S]*label: 'الملفات المصدّرة'/);
  assert.match(navigation, /settings:\s*\[[\s\S]*label: 'الفريق والصلاحيات'[\s\S]*label: 'شركات الشحن والعقود'[\s\S]*label: 'التكاملات ومصادر البيانات'[\s\S]*label: 'الأتمتة ووكلاء العمل'[\s\S]*label: 'القنوات والاتصال'[\s\S]*label: 'إعدادات النظام'/);
  assert.match(navigation, /'work-agents':\s*\{[^}]*section: 'settings'/);
  assert.match(navigation, /integrity:\s*\{[^}]*section: 'settings'/);
  assert.match(navigation, /'activity-log':\s*\{[^}]*section: 'settings'/);

  assert.doesNotMatch(app, /showSwitcher/);
  for (const path of ['/hub', '/carrier-kpi', '/claims', '/platform-carriers', '/tasks', '/drop', '/audits', '/aramex-statements', '/ledger', '/fulfillment', '/weight-billing', '/reports', '/monthly-report', '/internal-exports', '/activity-log', '/integrity', '/operations', '/uploads', '/webhook', '/work-agents', '/settings/hatif']) {
    assert.ok(app.includes(`'${path}'`), `legacy path ${path} must remain registered`);
  }
  assert.match(centerWorkspace, /params\.delete\('tab'\)/);
  assert.match(centerWorkspace, /onNavigate\(`\$\{next\.path\}\$\{query/);
});

test('center view menus stay task-oriented and never exceed six entries', async () => {
  const { CENTER_WORKSPACES } = await import('../src/lib/navigation.js');
  const expected = {
    sales: ['نمو عملاء لمحة', 'العملاء خارج المنصة', 'التواصل'],
    finance: ['مركز العملاء المالي', 'النقد والتسويات', 'الحسابات والمطابقة', 'الربحية والسيولة'],
    shipping: ['شركات الشحن', 'المهام والاستثناءات', 'دورة الشهر', 'فوترة الخدمات والأوزان'],
    reports: ['مكتبة التقارير', 'أداء التحصيل', 'أداء شركات الشحن', 'التواصل والحملات', 'الملفات المصدّرة'],
    settings: ['الفريق والصلاحيات', 'شركات الشحن والعقود', 'التكاملات ومصادر البيانات', 'الأتمتة ووكلاء العمل', 'القنوات والاتصال', 'إعدادات النظام'],
  };
  for (const [center, labels] of Object.entries(expected)) {
    assert.deepEqual(CENTER_WORKSPACES[center].map(item => item.label), labels);
    assert.ok(CENTER_WORKSPACES[center].length <= 6, `${center} exceeds six center views`);
  }
});

test('legacy entity and action routes resolve to canonical homes without removing route guards', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /rawPath === '\/upload'[\s\S]*navigate\('\/hub\?action=upload-invoice'/);
  assert.match(app, /rawPath === '\/merchants'[\s\S]*navigate\(`\/customer-360\?/);
  assert.match(app, /rawPath === '\/sales' \|\| rawPath === '\/crm'[\s\S]*\/retargeting\?view=today/);
  assert.match(app, /rawPath === '\/marketers'[\s\S]*\/workspace\/sales\?source=legacy-marketers/);
  assert.match(app, /rawPath === '\/campaigns'[\s\S]*!params\.get\('audienceContext'\)[\s\S]*\/whatsapp-settings\?tab=campaigns/);
  assert.doesNotMatch(app, /<Marketers /);
  assert.doesNotMatch(app, /<CrmWorkspace /);
  for (const path of ['/audits', '/claims', '/ledger', '/cod-settlements', '/aramex-statements', '/payments', '/carrier-kpi', '/contracts']) {
    assert.ok(app.includes(`'${path}':`), `${path} must keep a Carrier 360 legacy mapping`);
  }
  assert.match(app, /rawPath === '\/zoho-data'[\s\S]*forcedSectionId/);
  assert.match(app, /rawPath === '\/carrier-kpi'[\s\S]*forcedSectionId/);
});

test('phase two important filters and unavailable sources are explicit', async () => {
  const operations = await read('src/pages/OperationsCenter.jsx');
  const reports = await read('src/pages/ReportsCenter.jsx');
  const monthly = await read('src/pages/MonthlyReport.jsx');
  const activity = await read('src/pages/ActivityLog.jsx');

  assert.match(operations, /searchParams\.get\('status'\)/);
  assert.match(operations, /searchParams\.get\('source'\)/);
  assert.match(operations, /updateEventFilter\('status'/);
  assert.match(reports, /searchParams\.get\('month'\)/);
  assert.match(reports, /searchParams\.get\('carrier'\)/);
  assert.match(reports, /المصدر غير متاح/);
  assert.match(reports, /لم نعرض أصفارًا بديلة/);
  assert.match(monthly, /searchParams\.get\('month'\)/);
  assert.match(activity, /searchParams\.get\('action'\)/);
  assert.match(activity, /آخر تحديث:/);
  assert.match(activity, /لم نعرض سجلًا فارغًا/);
});
