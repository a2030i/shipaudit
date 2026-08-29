import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { campaignBucketLabel } from '../src/lib/customerCampaignBuckets.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('campaign aging labels are Arabic user-facing labels, never internal keys', () => {
  assert.equal(
    campaignBucketLabel(new Set(['opening', 'inv90p', 'inv31_60'])),
    '31–60 يوم + أكثر من 90 يوم + رصيد افتتاحي غير مدفوع',
  );
});

test('collection campaign handoff preserves the full selection equation', async () => {
  const page = await read('../src/pages/CustomerMoney.jsx');
  assert.match(page, /selectedCount:\s*reviewRows\.length/);
  assert.match(page, /eligibleCount:\s*rows\.length/);
  assert.match(page, /excludedBeforeChannelCount:\s*excludedRows\.length/);
  assert.match(page, /eligibilityExclusions:/);
  assert.match(page, /handoffContext\(bulkAction,\s*eligibleBulkRows,\s*bulkReview\)/);
});

test('smart campaign renders pre-channel exclusions and Arabic period names', async () => {
  const [page, service] = await Promise.all([
    read('../src/pages/SmartCampaignCenter.jsx'),
    read('../src/lib/smartCampaignService.js'),
  ]);
  assert.match(page, /المحدد في التحصيل/);
  assert.match(page, /غير مؤهل قبل القناة/);
  assert.match(page, /دخل فحص القناة/);
  assert.match(page, /!audienceSummary\.ready\.length/);
  assert.match(page, /لا يوجد جمهور جاهز بعد تطبيق فحوص الحماية/);
  assert.match(page, /campaignBucketLabel\(new Set\(Array\.isArray\(context\.aging\)/);
  assert.match(service, /describeCollectionAgingFilter\(buckets\)/);
  assert.match(service, /aging_filter:\s*agingLabel/);
  assert.doesNotMatch(service, /aging_filter:\s*buckets\.join/);
});
