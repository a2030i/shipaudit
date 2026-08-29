import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('invoice drill-down stays in the result context and exposes a full Customer 360 escape hatch', async () => {
  const [money, drawer, drawerCss] = await Promise.all([
    read('../src/pages/CustomerMoney.jsx'),
    read('../src/components/CustomerContextDrawer.jsx'),
    read('../src/components/customer-context-drawer.css'),
  ]);
  assert.match(money, /setContextDrawer\(\{ row: \{ \.\.\.row, agingBuckets: \[\.\.\.buckets\] \}, view: invoice \? 'invoices' : 'summary' \}\)/);
  assert.match(money, /saveWorkspaceState/);
  assert.match(money, /restoreWorkspaceScroll/);
  assert.match(drawer, /loadStore360Core/);
  assert.match(drawer, /loadStore360Finance/);
  assert.match(drawer, /الفواتير في السياق \(\{invoices\.length\}\)/);
  assert.match(drawer, /فتح Customer 360 الكامل/);
  assert.match(drawerCss, /\.context-drawer-panel/);
  assert.match(drawerCss, /@media \(max-width:\s*640px\)/);
});

test('collections campaign handoff preserves audience, channel, return path and selected rows', async () => {
  const [collections, campaigns] = await Promise.all([
    read('../src/pages/Collections.jsx'),
    read('../src/pages/SmartCampaignCenter.jsx'),
  ]);
  assert.match(collections, /originLabel: 'قائمة التحصيل'/);
  assert.match(collections, /aging: CUSTOMER_CAMPAIGN_BUCKETS\.map\(bucket => bucket\.key\)/);
  assert.match(collections, /saveWorkspaceState\(workspaceKey, \{ selectionKeys:/);
  assert.match(collections, /channel=\$\{channel\}/);
  assert.match(campaigns, /العودة إلى \{handoffOriginLabel\}/);
  assert.match(campaigns, /audienceHandoff\.returnTo/);
});

test('center navigation remembers the last operational workspace and removes the obsolete ticket shortcut', async () => {
  const app = await read('../src/App.jsx');
  assert.match(app, /LAST_CENTER_ROUTE_PREFIX/);
  assert.match(app, /localStorage\.setItem\(`\$\{LAST_CENTER_ROUTE_PREFIX\}\$\{item\.section\}`/);
  assert.match(app, /localStorage\.getItem\(`\$\{LAST_CENTER_ROUTE_PREFIX\}\$\{center\.id\}`/);
  assert.match(app, /customers: 'بحث أو فتح عميل'/);
  assert.doesNotMatch(app, /فتح تذكرة عميل/);
});

test('command center negative-wallet signal is aggregate-only, permission-scoped and read-only', async () => {
  const [sql, service, commandCenter] = await Promise.all([
    read('../supabase/migrations/20260828195930_overview_negative_wallet_summary.sql'),
    read('../src/lib/overviewService.js'),
    read('../src/components/operations/FigmaCommandCenter.jsx'),
  ]);
  assert.match(sql, /negative_wallet as materialized/);
  assert.match(sql, /wallet_balance,\s*0\) < -0\.5/);
  assert.match(sql, /stable\s+security invoker/i);
  assert.match(sql, /crm_has_permission\('overview\.view'\)/);
  assert.match(sql, /revoke all on function public\.overview_merchant_pulse_lite\(text\) from public, anon/);
  assert.match(sql, /grant execute on function public\.overview_merchant_pulse_lite\(text\) to authenticated, service_role/);
  assert.doesNotMatch(sql, /\b(insert|update|delete|merge|truncate)\b\s+(into|public\.|from)/i);
  assert.doesNotMatch(sql, /http|net\.|functions\.invoke|dblink/i);
  assert.match(service, /negativeWalletAmount/);
  assert.match(commandCenter, /decisionSummary\.negativeWallet/);
});
