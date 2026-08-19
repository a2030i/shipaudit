import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  agingEntityKey, buildAgingRows, buildCampaignAgingProjection, evaluateBulkEligibility,
  lineMatchesAging, normalizeCollectibleLine, summarizeAgingLines,
} from '../src/lib/agingOperations.js';

const lines = [
  { contact_id: 'z1', line_kind: 'invoice', invoice_number: 'INV-1', age_days: 95, collectible_amount: 100.11, due_date: '2026-01-01' },
  { contact_id: 'z1', line_kind: 'invoice', invoice_number: 'INV-2', age_days: 120, collectible_amount: 50.22, due_date: '2025-12-01' },
  { contact_id: 'z1', line_kind: 'invoice', invoice_number: 'INV-3', age_days: 40, collectible_amount: 20.33, due_date: '2026-03-01' },
  { contact_id: 'z1', line_kind: 'opening_balance', age_days: 200, collectible_amount: 10.44, due_date: '2026-01-10' },
];

test('Aging +90 amount reconciles with the exact invoice details to the halala', () => {
  const summary = summarizeAgingLines(lines, new Set(['inv90p']));
  assert.equal(summary.amount, 150.33);
  assert.equal(summary.invoiceCount, 2);
  assert.equal(summary.openingCount, 0);
  assert.equal(summary.oldestDays, 120);
});

test('opening balance is isolated from +90 invoices', () => {
  assert.equal(lineMatchesAging(lines[3], new Set(['inv90p'])), false);
  assert.equal(lineMatchesAging(lines[3], new Set(['opening'])), true);
  assert.equal(summarizeAgingLines(lines, new Set(['opening'])).amount, 10.44);
});

test('Zoho opening-balance documents are reclassified from +90 without using name or phone', () => {
  const sourceLine = {
    contact_id: '7589996000000301333',
    contact_name: 'متجر الأندية',
    line_kind: 'invoice',
    invoice_number: 'الرصيد الافتتاحي للالعملاء',
    age_days: 221,
    collectible_amount: 30270.63,
    due_date: '2026-01-10',
  };
  const normalized = normalizeCollectibleLine(sourceLine);
  assert.equal(normalized.line_kind, 'opening_balance');
  assert.equal(lineMatchesAging(sourceLine, new Set(['inv90p'])), false);
  assert.equal(lineMatchesAging(sourceLine, new Set(['opening'])), true);

  const projection = buildCampaignAgingProjection([sourceLine], new Set(['7589996000000301333']));
  assert.equal(projection.totals.opening, 30270.63);
  assert.equal(projection.totals.inv90p, 0);
  assert.equal(projection.byContact.get('7589996000000301333').opening, 30270.63);
});

test('Aging rows join money to invoice lines by Zoho contact id, not name or phone', () => {
  const customers = [{ name: 'duplicate name', storeName: 'متجر 1', storeId: 's1', zohoId: 'z1', phone: '0500000000', owed: 180 }];
  const rows = buildAgingRows({ customers, lines, buckets: new Set(['inv90p']) });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].identityKey, 'store:s1');
  assert.equal(rows[0].summary.amount, 150.33);
  assert.equal(agingEntityKey({ name: 'name only', phone: '0500' }), '');
});

test('Aging bucket URL update is atomic and keeps the complete return location', async () => {
  const money = await readFile(new URL('../src/pages/CustomerMoney.jsx', import.meta.url), 'utf8');
  assert.match(money, /params\.delete\('page'\);\s*setSearchParams\(params\);/);
  assert.match(money, /const returnTo = `\$\{location\.pathname\}\$\{location\.search\}`/);
  const handler = money.slice(money.indexOf('const handleAgingFilter'), money.indexOf('const toggleAgingSelection'));
  assert.doesNotMatch(handler, /updateUrlFilters\(\{ page: null \}/);
});

test('bulk assignment excludes missing tasks instead of silently creating them', () => {
  const customer = { storeId: 's1', zohoId: 'z1', balanceSyncIssue: false };
  const base = { customer, identityKey: 'store:s1', summary: { amount: 100 } };
  const [missing] = evaluateBulkEligibility([base], 'assign', { canAssign: true });
  assert.equal(missing.eligible, false);
  assert.match(missing.exclusionReason, /لن ننشئها صامتًا/);
  const [ready] = evaluateBulkEligibility([{ ...base, task: { id: 't1' } }], 'assign', { canAssign: true });
  assert.equal(ready.eligible, true);
});

test('campaign and IVR handoff keep audience identities outside the URL and require review', async () => {
  const money = await readFile(new URL('../src/pages/CustomerMoney.jsx', import.meta.url), 'utf8');
  const campaign = await readFile(new URL('../src/pages/SmartCampaignCenter.jsx', import.meta.url), 'utf8');
  assert.match(money, /saveAudienceHandoff\(context\)/);
  assert.match(money, /audienceContext=\$\{encodeURIComponent\(token\)\}/);
  assert.doesNotMatch(money, /audienceContext=.*phone/);
  assert.match(campaign, /setStep\(5\)/);
  assert.match(campaign, /عند الاختيار/);
  assert.match(campaign, /الآن/);
  assert.match(campaign, /channel === 'whatsapp' \|\| channel === 'ivr'/);
});

test('Store 360 receives the Aging buckets and resolves detail lines with the stable Zoho id', async () => {
  const page = await readFile(new URL('../src/pages/Store360Page.jsx', import.meta.url), 'utf8');
  const service = await readFile(new URL('../src/lib/store360Service.js', import.meta.url), 'utf8');
  assert.match(page, /agingBuckets=\{agingBuckets\}/);
  assert.match(service, /loadZohoOpenInvoices\(customerName, \{ zohoId \}\)/);
  assert.match(service, /allDetails\.filter\(row => lineMatchesAging\(row, selectedBuckets\)\)/);
  assert.match(service, /buildCampaignAgingProjection\(allDetails\)/);
  assert.match(service, /selectedAmount/);
});

test('source failures and permission failures remain explicit and block unsafe bulk actions', async () => {
  const page = await readFile(new URL('../src/pages/CustomerMoney.jsx', import.meta.url), 'utf8');
  const queue = await readFile(new URL('../src/components/operations/AgingOperationsQueue.jsx', import.meta.url), 'utf8');
  assert.match(page, /sourceHealthy=\{!agingLinesError && !loadError\}/);
  assert.match(page, /مبلغ الشريحة لا يطابق تفاصيلها بالهللة/);
  assert.match(queue, /مصدر التفاصيل غير متاح/);
  const customer = { storeId: 's1', zohoId: 'z1', phone: '0500000000' };
  const base = { customer, identityKey: 'store:s1', summary: { amount: 100 }, task: { id: 't1' } };
  assert.equal(evaluateBulkEligibility([base], 'ivr', { canIvr: false })[0].eligible, false);
  assert.equal(evaluateBulkEligibility([base], 'campaign', { canCampaign: false })[0].eligible, false);
});

test('Aging can explicitly select every filtered result across pages', async () => {
  const page = await readFile(new URL('../src/pages/CustomerMoney.jsx', import.meta.url), 'utf8');
  const queue = await readFile(new URL('../src/components/operations/AgingOperationsQueue.jsx', import.meta.url), 'utf8');

  assert.match(page, /new Set\(agingRows\.map\(row => row\.identityKey\)\)/);
  assert.match(page, /allResultsSelected=\{allAgingSelected\}/);
  assert.match(queue, /تحديد كل النتائج \(\{totalRows\}\)/);
  assert.match(queue, /onToggleAll\(true\)/);
  assert.match(queue, /إلغاء تحديد الكل/);
});
