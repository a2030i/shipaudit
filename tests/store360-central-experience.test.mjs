import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('Store 360 routes a single store to campaign review without placing recipients in the URL', async () => {
  const page = await read('../src/pages/Store360Page.jsx');
  assert.match(page, /saveAudienceHandoff\(context\)/);
  assert.match(page, /audienceContext=\$\{encodeURIComponent\(token\)\}/);
  assert.doesNotMatch(page, /recipients=\$\{/);
  assert.match(page, /selectionKeys: \[`store:\$\{store\.storeId\}`\]/);
  assert.match(page, /source: 'store_360'/);
});

test('Smart Campaign Center accepts Store 360 and Aging handoffs in review mode', async () => {
  const page = await read('../src/pages/SmartCampaignCenter.jsx');
  assert.match(page, /\['aging_operations', 'store_360'\]\.includes\(context\.source\)/);
  assert.match(page, /context\.source === 'store_360'/);
  assert.match(page, /manualRows: Array\.isArray\(context\.manualRows\)/);
  assert.match(page, /setStep\(5\)/);
});

test('Store 360 opens scoped balance reconciliation and existing carrier center', async () => {
  const page = await read('../src/pages/Store360Page.jsx');
  assert.match(page, /\/reconciliation\?tab=zoho_live&store=/);
  assert.match(page, /search=\$\{encodeURIComponent\(store\.storeName\)\}/);
  assert.match(page, /\/hub\?source=store360&returnTo=/);
  assert.match(page, /نتائج العقود والأسعار تبقى من محرك تدقيق الناقل المعتمد دون إعادة حساب/);
});

test('Reconciliation scopes the customer view by Store ID as well as the display name', async () => {
  const page = await read('../src/pages/Reconciliation.jsx');
  assert.match(page, /initialSearch=/);
  assert.match(page, /\[r\.storeId, r\.storeName, r\.phone/);
});
