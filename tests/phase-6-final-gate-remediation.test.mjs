import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizePhoneForDisplay } from '../src/lib/presentationFormatters.js';
import { applyVerifiedFinancialPosition, buildCustomerDirectoryRows } from '../src/lib/customerDirectoryPresentation.js';
import { pageTitle } from '../src/lib/pageTitles.js';
import { buildStore360Url } from '../src/lib/store360Navigation.js';
import { operationalDetailPath, reportReturnPath, withWorkspaceReturn } from '../src/lib/workspaceJourneyNavigation.js';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('FSG-05: unverified Zoho match never transfers debt to store 199', () => {
  const merchant = { store_id: 199, store_name: 'Store 199', phone: '+966500000199', wallet_balance: 0 };
  const customer = {
    zohoId: 'zoho-unlinked', name: 'Legacy fuzzy match', total: 1094.72,
    merchant: { storeId: 199, storeName: 'Store 199' }, merchantMatch: { method: 'name-exact' },
  };
  const rows = buildCustomerDirectoryRows({ customers: [customer], merchants: [merchant], snapshot: { merchants: { uploadedAt: '2026-09-04T15:00:00Z' } } });
  const store199 = applyVerifiedFinancialPosition(rows.find(row => String(row.storeId) === '199'), { financial: null });
  assert.equal(store199.debt, 0);
  assert.equal(store199.risk, null);
  assert.equal(store199.financialLinkResolved, false);
});

test('FSG-05: explicit Lamha-Zoho link remains the sole directory financial join', () => {
  const linkedMerchant = { storeId: 199, storeName: 'Store 199', phone: '+966500000199' };
  const rows = buildCustomerDirectoryRows({
    customers: [{ zohoId: 'z199', name: 'Store 199', total: 1094.72, merchant: linkedMerchant, merchantMatch: { method: 'lamha-zoho-id', linkedAt: '2026-09-04T15:05:00Z' } }],
    merchants: [{ store_id: 199, store_name: 'Store 199', phone: '+966500000199' }],
    snapshot: { merchants: { uploadedAt: '2026-09-04T15:00:00Z' } },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].storeId, 199);
  const verified = applyVerifiedFinancialPosition(rows[0], { financial: { accountingOutstanding: 1094.72, oldestDays: 45 } });
  assert.equal(verified.debt, 1094.72);
  assert.equal(rows[0].financialLinkResolved, true);
});

test('FSG-06: phone display removes only confirmed spreadsheet artifacts', () => {
  assert.equal(normalizePhoneForDisplay("'+966550413239"), '+966550413239');
  assert.equal(normalizePhoneForDisplay("'0550413239"), '0550413239');
  assert.equal(normalizePhoneForDisplay('’00966550413239'), '00966550413239');
  assert.equal(normalizePhoneForDisplay("'invoice-199"), "'invoice-199");
  assert.equal(normalizePhoneForDisplay("O'Neil"), "O'Neil");
});

test('FSG-06: customer-facing financial reconciliation uses the central phone formatter', async () => {
  const reconciliation = await source('src/pages/Reconciliation.jsx');
  assert.match(reconciliation, /PhoneNumber value=\{r\.phone\}/);
  assert.match(reconciliation, /PhoneNumber value=\{m\.phone\}/);
});

test('FSG-01: sales journey preserves the exact result-set context', () => {
  const returnTo = '/workspace/sales?view=retargeting&status=all&page=3';
  const target = withWorkspaceReturn('/customer-360?customer=75&open=1&view=overview', { source: 'sales', returnTo });
  const params = new URL(target, 'https://shipaudit.local').searchParams;
  assert.equal(params.get('customer'), '75');
  assert.equal(params.get('source'), 'sales');
  assert.equal(params.get('returnTo'), returnTo);
});

test('FSG-02: campaign journey preserves audience and return context', () => {
  const returnTo = '/workspace/campaigns?audienceResult=review&campaign=cmp-9';
  const target = buildStore360Url({ storeId: 1115, source: 'campaign-audience', returnTo });
  const params = new URL(target, 'https://shipaudit.local').searchParams;
  assert.equal(params.get('customer'), '1115');
  assert.equal(params.get('source'), 'campaign-audience');
  assert.equal(params.get('returnTo'), returnTo);
});

test('FSG-03: operations journey canonicalizes carrier identity and preserves filters', () => {
  const returnTo = '/workspace/operations?status=exception&page=2&carrier=aramex';
  const target = operationalDetailPath('/carrier?carrier=c-7&view=account&panel=ledger&status=unaudited', returnTo);
  const params = new URL(target, 'https://shipaudit.local').searchParams;
  assert.equal(params.get('id'), 'c-7');
  assert.equal(params.has('carrier'), false);
  assert.equal(params.get('status'), 'unaudited');
  assert.equal(params.get('returnTo'), returnTo);
});

test('FSG-04: reports accept only their explicit internal return path', () => {
  const target = '/workspace/reports?range=custom&from=2026-08-01&to=2026-09-04';
  assert.equal(reportReturnPath('reports', target), target);
  assert.equal(reportReturnPath('finance', target), null);
  assert.equal(reportReturnPath('reports', 'https://example.com/escape'), null);
});

test('FSG-01..04: journey consumers use the shared contracts', async () => {
  const [sales, campaigns, operations, reports, carrierLedger, collectionsHub] = await Promise.all([
    source('src/pages/Retargeting.jsx'),
    source('src/pages/SmartCampaignCenter.jsx'),
    source('src/components/enterprise/EnterpriseOperationsOverview.jsx'),
    source('src/pages/CustomerMoney.jsx'),
    source('src/pages/CarrierLedger.jsx'),
    source('src/pages/CollectionsHub.jsx'),
  ]);
  assert.match(sales, /withWorkspaceReturn\(customer\.path/);
  assert.match(sales, /source: 'sales'/);
  assert.match(campaigns, /source: 'campaign-audience'/);
  assert.match(campaigns, /returnTo: `\$\{location\.pathname\}\$\{location\.search\}`/);
  assert.match(campaigns, /onRowClick=\{openAudienceCustomer\}/);
  assert.match(operations, /operationalDetailPath/);
  assert.match(carrierLedger, /if \(!isActive \|\| embedded\) return/);
  assert.match(reports, /العودة إلى التقرير/);
  assert.match(reports, /navigate\(reportReturnTo\)/);
  assert.match(collectionsHub, /navigate\(reportReturnTo\)/);
});

test('FSG-07: campaign workspace composes the enterprise visual primitives', async () => {
  const campaigns = await source('src/pages/SmartCampaignCenter.jsx');
  const css = await source('src/pages/smart-campaign-center.css');
  for (const primitive of ['<Page ', '<PageHeader', '<StatStrip', '<FilterBar', '<Surface', '<DataTable', '<Alert ']) {
    assert.ok(campaigns.includes(primitive), `missing shared primitive ${primitive}`);
  }
  assert.match(css, /Final-system remediation/);
  assert.match(css, /var\(--ds-brand\)/);
  assert.match(css, /var\(--ds-surface\)/);
});

test('FSG-08: every primary workspace has a shared page title', () => {
  assert.equal(pageTitle('/workspace/customers'), 'العملاء والمتاجر');
  assert.equal(pageTitle('/workspace/finance'), 'المركز المالي');
  assert.equal(pageTitle('/workspace/admin'), 'الإدارة والإعدادات');
});

test('FSG-09: command menu restores focus for every close path', async () => {
  const palette = await source('src/components/CommandPalette.jsx');
  assert.match(palette, /restoreFocusRef/);
  assert.match(palette, /restoreFocusRef\.current\?\.isConnected/);
  assert.match(palette, /requestAnimationFrame\(\(\) => target\.focus\(\)\)/);
  assert.match(palette, /aria-label="إغلاق لوحة الأوامر"/);
  assert.match(palette, /onClose\(\);\s*\n\s*navigate\(item\.path\)/);
});
