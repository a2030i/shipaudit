import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  TAHSEEL_PORTAL_TEMPLATE_BODY,
  TAHSEEL_PORTAL_TEMPLATE_MAP,
  TAHSEEL_PORTAL_TEMPLATE_NAME,
  TAHSEEL_PORTAL_URL,
  renderTahseelPortalTemplate,
} from '../src/lib/tahseelPortalTemplate.js';

test('portal template uses the fixed Lamha portal and three documented variables', () => {
  assert.equal(TAHSEEL_PORTAL_URL, 'https://lamha.thseel.com/login');
  assert.equal(TAHSEEL_PORTAL_TEMPLATE_NAME, 'tahseel_portal_balance');
  assert.deepEqual(TAHSEEL_PORTAL_TEMPLATE_MAP.map(x => x.src), [
    'field:name',
    'field:full_amount',
    'field:count',
  ]);
  assert.match(TAHSEEL_PORTAL_TEMPLATE_BODY, /\{\{1\}\}/);
  assert.match(TAHSEEL_PORTAL_TEMPLATE_BODY, /\{\{2\}\}/);
  assert.match(TAHSEEL_PORTAL_TEMPLATE_BODY, /\{\{3\}\}/);
  assert.match(TAHSEEL_PORTAL_TEMPLATE_BODY, /رمز التحقق/);
});

test('portal preview formats a full customer balance without leaving placeholders', () => {
  const rendered = renderTahseelPortalTemplate({
    name: 'متجر المثال',
    fullAmount: 1234.5,
    invoiceCount: 4,
  });
  assert.match(rendered, /متجر المثال/);
  assert.match(rendered, /1,234\.50/);
  assert.match(rendered, /4 فاتورة/);
  assert.doesNotMatch(rendered, /\{\{/);
});

test('collections expose the full balance separately from the selected aging slice', async () => {
  const source = await readFile(new URL('../src/pages/CustomerMoney.jsx', import.meta.url), 'utf8');
  assert.match(source, /full_amount:\s*c\.owed/);
  assert.match(source, /amount:\s*amt/);
});
