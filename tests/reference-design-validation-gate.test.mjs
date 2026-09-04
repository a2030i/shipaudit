import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('reference design system exposes the mandatory migration primitives', async () => {
  const ui = await read('src/design-system/EnterpriseUI.jsx');
  for (const primitive of [
    'AppShell', 'Page', 'PageHeader', 'Breadcrumbs', 'DataTable', 'FilterBar', 'StatStrip',
    'StatusBadge', 'Tabs', 'Drawer', 'Dialog', 'FormField', 'EmptyState',
    'LoadingState', 'ErrorState',
  ]) {
    assert.match(ui, new RegExp(`export function ${primitive}\\b|export const ${primitive}\\b`), `${primitive} must remain centralized`);
  }
});

test('DataTable owns the full enterprise state and interaction contract', async () => {
  const ui = await read('src/design-system/EnterpriseUI.jsx');
  for (const contract of [
    /aria-busy/, /<caption/, /aria-sort/, /loading = false/, /error = null/,
    /hiddenColumnKeys/, /selection/, /تحديد الصفحة/, /LoadingState/,
    /ErrorState/, /EmptyState/, /onKeyDown/,
  ]) assert.match(ui, contract);
});

test('the four reference screens consume shared page and table primitives', async () => {
  const [command, customers, finance, store] = await Promise.all([
    read('src/components/enterprise/EnterpriseCommandCenter.jsx'),
    read('src/components/enterprise/EnterpriseCustomerDirectory.jsx'),
    read('src/components/enterprise/EnterpriseFinanceOverview.jsx'),
    read('src/pages/Store360Page.jsx'),
  ]);
  for (const source of [command, customers, finance]) {
    assert.match(source, /<Page\b/);
    assert.match(source, /<PageHeader\b/);
    assert.doesNotMatch(source, /<style\b|style=\{\{/);
  }
  assert.match(customers, /<DataTable[\s\S]*caption="سجل العملاء والمتاجر"/);
  assert.match(command, /caption="القرارات التي تحتاج إجراء الآن"/);
  assert.match(finance, /caption="الإجراءات المالية ذات الأولوية"/);
  assert.match(store, /<EntityPageHeader\b/);
  assert.match(store, /caption="مشاكل وتنبيهات العميل"/);
});

test('mobile tabs, touch targets and RTL values remain design-system contracts', async () => {
  const [ui, components, responsive, shell] = await Promise.all([
    read('src/design-system/EnterpriseUI.jsx'),
    read('src/design-system/components.css'),
    read('src/design-system/responsive.css'),
    read('src/design-system/shell.css'),
  ]);
  assert.match(ui, /ds-tabs__mobile-select/);
  assert.match(responsive, /\.ds-tabs\{display:none!important\}/);
  assert.match(responsive, /\.ds-pagination button\{width:44px;height:44px\}/);
  assert.match(components, /\.ds-money,.ds-number,.ds-identifier[\s\S]*unicode-bidi:isolate/);
  assert.match(ui, /className=\{classNames\('ds-money',[\s\S]*dir="ltr"/);
  assert.match(shell, /body \.topbar-breadcrumb\{display:none!important\}/);
});
