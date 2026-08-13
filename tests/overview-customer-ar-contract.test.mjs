import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const service = await readFile(new URL('../src/lib/overviewService.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../src/pages/Overview.jsx', import.meta.url), 'utf8');

test('overview effective cash uses collectible customer debt, not gross Zoho debit', () => {
  assert.match(service, /supabaseRpc\('customer_money_dashboard'\)/);
  assert.match(service, /const collectibleAr = Number\(customerMoney\?\.outstanding\)/);
  assert.match(service, /const totalAR = arFromZoho \? collectibleAr/);
  assert.match(service, /customerCreditOffset:/);
});

test('overview explains that customer credits are removed from collectible cash', () => {
  assert.match(page, /customerCreditOffset > 0\.005/);
  assert.match(page, /cash\.customerCreditOffset/);
});

test('overview customer decisions use safe identifiers and invoice-only post-30 debt', () => {
  assert.match(service, /newest platform snapshot/i);
  assert.match(service, /fuzzy name match is intentionally forbidden/i);
  assert.match(service, /decisionNumber\(customer\.b1\) \+ decisionNumber\(customer\.b2\) \+ decisionNumber\(customer\.b3\)/);
  assert.match(service, /row\.over30 > 0\.5 && row\.invoiceCount > 0/);
  assert.match(service, /isPlatformInactive\(row\.platformStatus\) && row\.over30 <= 0\.5/);
  assert.match(service, /sourceStates\.customerMoney\?\.status === 'fresh'[\s\S]*sourceStates\.merchants\?\.status === 'fresh'/);
  assert.match(service, /sourceStates\.zohoInvoiceSync\?\.status === 'fresh'/);
  assert.match(service, /Availability and freshness are different concerns/);
  assert.match(service, /const customerDecisionDataReadable/);
  assert.match(service, /customerDecisionFresh,/);
  assert.match(service, /merchantSnapshotSourceState/);
  assert.match(service, /row\?\.store_id \?\? row\?\.storeId/);
  assert.match(service, /row\?\.store_name \?\? row\?\.storeName/);
  assert.match(service, /row\?\.billing_type \?\? row\?\.billingType/);
  assert.match(service, /row\?\.platform_status \?\? row\?\.platformStatus/);
  assert.match(page, /fresh=\{data\.customerDecisionFresh\}/);
  assert.match(page, /customer-decision-stale/);
  assert.match(page, /أوقف الحسابات المتأخرة/);
  assert.match(page, /شغّل الحسابات الجاهزة/);
  assert.match(page, /خصم الرصيد المدفوع مقدمًا/);
  assert.match(page, /لا ينفذ النظام إيقافًا أو تفعيلًا أو خصمًا تلقائيًا/);
});

test('customer money contract carries Zoho identity for reconciliation matching', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260813125000_customer_money_dashboard_zoho_identity.sql', import.meta.url), 'utf8');
  const pnlService = await readFile(new URL('../src/lib/pnlService.js', import.meta.url), 'utf8');
  assert.match(migration, /ar\.zoho_id/);
  assert.match(migration, /'zoho_id',cf\.zoho_id/);
  assert.match(pnlService, /issueByZohoId/);
  assert.match(pnlService, /duplicate display-name/);
});
