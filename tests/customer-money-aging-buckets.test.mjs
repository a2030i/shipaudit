import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  CUSTOMER_CAMPAIGN_BUCKETS,
  selectedCampaignAmount,
} from '../src/lib/customerCampaignBuckets.js';

const page = await readFile(new URL('../src/pages/CustomerMoney.jsx', import.meta.url), 'utf8');
const portfolio = await readFile(new URL('../src/components/operations/FigmaCustomerPortfolio.jsx', import.meta.url), 'utf8');
const service = await readFile(new URL('../src/lib/pnlService.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260808160000_split_customer_money_recent_aging.sql', import.meta.url), 'utf8');
const campaignMigration = await readFile(new URL('../supabase/migrations/20260815203000_customer_collection_campaign_buckets.sql', import.meta.url), 'utf8');

test('customer collection exposes focused invoice and opening-balance campaign slices', () => {
  assert.deepEqual(CUSTOMER_CAMPAIGN_BUCKETS.map(bucket => bucket.label), [
    '1–15 يوم', '16–30 يوم', '31–60 يوم', '61–90 يوم', 'أكثر من 90 يوم', 'رصيد افتتاحي غير مدفوع',
  ]);
  assert.match(page, /فلتر شرائح السداد/);
  assert.match(page, /شريحة مستقلة ولا تدخل ضمن «أكثر من 90 يوم»/);
  assert.match(page, /openFocusedCampaign/);
  assert.match(page, /campaignPanel=\{campaignSegmentsPanel\}/);
  assert.match(page, /campaignActionLabel=\{buckets\.size \? 'مراجعة الحملة' : 'اختيار شرائح الحملة'\}/);
  assert.match(portfolio, /campaignPanel && <div className="fcp-campaign-panel">\{campaignPanel\}<\/div>/);
  assert.ok(
    portfolio.indexOf('className="fcp-campaign-panel"') < portfolio.indexOf('className="fcp-metrics"'),
    'campaign segments must render above decision metrics and the customer table',
  );
});

test('selected campaign amount never mixes +90 invoices with the opening balance', () => {
  const customer = { owed: 1000, inv90p: 300, opening: 200 };
  assert.equal(selectedCampaignAmount(customer, new Set(['inv90p'])), 300);
  assert.equal(selectedCampaignAmount(customer, new Set(['opening'])), 200);
  assert.equal(selectedCampaignAmount(customer, new Set(['inv90p', 'opening'])), 500);
  assert.equal(selectedCampaignAmount(customer, new Set()), 1000);
});

test('dashboard adapter maps both recent aging buckets', () => {
  assert.match(service, /b0_15: Number\(d\.aging\?\.b0_15\)/);
  assert.match(service, /b16_30: Number\(d\.aging\?\.b16_30\)/);
  assert.match(service, /b0_15: Number\(c\.b0_15\)/);
  assert.match(service, /b16_30: Number\(c\.b16_30\)/);
  assert.match(service, /supabase\.rpc\('customer_collection_campaign_buckets'\)/);
  assert.match(service, /const campaignRow = campaignFor\(c\)/);
  assert.match(service, /inv1_15: Number\(campaignRow\.inv_1_15\)/);
  assert.match(service, /inv90p: Number\(campaignRow\.inv_90p\)/);
});

test('database campaign slices use overdue invoice days and isolate opening balances', () => {
  assert.match(campaignMigration, /line_kind = 'invoice' and l\.age_days between 1 and 15/);
  assert.match(campaignMigration, /line_kind = 'invoice' and l\.age_days between 16 and 30/);
  assert.match(campaignMigration, /line_kind = 'invoice' and l\.age_days between 31 and 60/);
  assert.match(campaignMigration, /line_kind = 'invoice' and l\.age_days between 61 and 90/);
  assert.match(campaignMigration, /line_kind = 'invoice' and l\.age_days > 90/);
  assert.match(campaignMigration, /line_kind = 'opening_balance'/);
  assert.match(campaignMigration, /grant execute on function public\.customer_collection_campaign_buckets\(\) to authenticated/);
});

test('customer collection refreshes platform status after a newer merchant snapshot', () => {
  assert.match(page, /dashboardRefreshInFlightRef/);
  assert.match(page, /window\.addEventListener\('focus', refreshIfStale\)/);
  assert.match(page, /document\.addEventListener\('visibilitychange', refreshIfStale\)/);
  assert.match(page, /window\.setInterval\(refreshIfStale, 120_000\)/);
  assert.doesNotMatch(page, /if \(isActive && d == null\) refresh\(\)/);
});

test('database calculates the split from invoice age and keeps the old aggregate compatible', () => {
  assert.match(migration, /l\.age_days between 0 and 15/);
  assert.match(migration, /l\.age_days between 16 and 30/);
  assert.match(migration, /'b0_15'/);
  assert.match(migration, /'b16_30'/);
  assert.match(migration, /'b0_30'.*sum\(b0_15 \+ b16_30\)/s);
});
