import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  TAHSEEL_PORTAL_TEMPLATE_BODY,
  TAHSEEL_PORTAL_TEMPLATE_MAP,
  TAHSEEL_PORTAL_TEMPLATE_NAME,
  TAHSEEL_PORTAL_URL,
  describeCollectionAgingFilter,
  renderTahseelPortalTemplate,
} from '../src/lib/tahseelPortalTemplate.js';

test('portal template uses the fixed Lamha portal and five documented variables', () => {
  assert.equal(TAHSEEL_PORTAL_URL, 'https://lamha.thseel.com/login');
  assert.equal(TAHSEEL_PORTAL_TEMPLATE_NAME, 'tahseel_portal_balance_v2');
  assert.deepEqual(TAHSEEL_PORTAL_TEMPLATE_MAP.map(x => x.src), [
    'field:name',
    'field:full_amount',
    'field:count',
    'field:filtered_overdue_amount',
    'field:aging_filter',
  ]);
  assert.match(TAHSEEL_PORTAL_TEMPLATE_BODY, /\{\{1\}\}/);
  assert.match(TAHSEEL_PORTAL_TEMPLATE_BODY, /\{\{2\}\}/);
  assert.match(TAHSEEL_PORTAL_TEMPLATE_BODY, /\{\{3\}\}/);
  assert.match(TAHSEEL_PORTAL_TEMPLATE_BODY, /\{\{4\}\}/);
  assert.match(TAHSEEL_PORTAL_TEMPLATE_BODY, /\{\{5\}\}/);
  assert.match(TAHSEEL_PORTAL_TEMPLATE_BODY, /رمز التحقق/);
});

test('portal preview formats a full customer balance without leaving placeholders', () => {
  const rendered = renderTahseelPortalTemplate({
    name: 'متجر المثال',
    fullAmount: 1234.5,
    filteredOverdueAmount: 934.5,
    agingFilter: 'أكثر من 30 يوم',
    invoiceCount: 4,
  });
  assert.match(rendered, /متجر المثال/);
  assert.match(rendered, /1,234\.50/);
  assert.match(rendered, /934\.50/);
  assert.match(rendered, /أكثر من 30 يوم/);
  assert.match(rendered, /4 فاتورة/);
  assert.doesNotMatch(rendered, /\{\{/);
});

test('aging description follows contiguous campaign filter thresholds', () => {
  assert.equal(describeCollectionAgingFilter([], 124), 'حتى 124 يومًا (حسب أقدم فاتورة)');
  assert.equal(describeCollectionAgingFilter([], 0), 'لا توجد مدة تأخير مسجلة');
  assert.equal(describeCollectionAgingFilter(['b16_30', 'b1', 'b2', 'b3']), 'أكثر من 15 يوم');
  assert.equal(describeCollectionAgingFilter(['b1', 'b2', 'b3']), 'أكثر من 30 يوم');
  assert.equal(describeCollectionAgingFilter(['b2', 'b3']), 'أكثر من 60 يوم');
  assert.equal(describeCollectionAgingFilter(['b3']), 'أكثر من 90 يوم');
  assert.equal(describeCollectionAgingFilter(['b16_30', 'b2']), 'من 16 إلى 30 يوم، من 61 إلى 90 يوم');
});

test('collections expose the full balance separately from the selected aging slice', async () => {
  const source = await readFile(new URL('../src/pages/CustomerMoney.jsx', import.meta.url), 'utf8');
  assert.match(source, /full_amount:\s*c\.owed/);
  assert.match(source, /filtered_overdue_amount:\s*amt/);
  assert.match(source, /aging_filter:\s*describeCollectionAgingFilter\(\[\.\.\.buckets\],\s*c\.oldestDays\)/);
  assert.match(source, /amount:\s*amt/);
});
