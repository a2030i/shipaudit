import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildStore360Url } from '../src/lib/store360Navigation.js';

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
  assert.match(page, /search=\{resultSearch\}/);
  assert.match(page, /readReconciliationJourneyContext\(location\.search\)/);
  assert.match(page, /\[r\.storeId, r\.storeName, r\.phone/);
});

test('Store 360 navigation requires a numeric Store ID and preserves workflow context', () => {
  assert.equal(buildStore360Url({ storeId: 'متجر الأندية' }), null);
  assert.equal(buildStore360Url({ storeId: '+966500000000' }), null);
  const url = buildStore360Url({
    storeId: 847,
    view: 'finance',
    source: 'aging',
    aging: ['inv31_60', 'inv90p'],
    invoice: 'bucket',
    returnTo: '/customer-money?aging=inv90p&page=3&search=club',
  });
  const parsed = new URL(url, 'https://example.test');
  assert.equal(parsed.pathname, '/customer-360');
  assert.equal(parsed.searchParams.get('customer'), '847');
  assert.equal(parsed.searchParams.get('view'), 'finance');
  assert.equal(parsed.searchParams.get('aging'), 'inv31_60,inv90p');
  assert.equal(parsed.searchParams.get('invoice'), 'bucket');
  assert.equal(parsed.searchParams.get('returnTo'), '/customer-money?aging=inv90p&page=3&search=club');
});

test('Store 360 leads with a decision and exposes scoped reconciliation in finance', async () => {
  const [page, service] = await Promise.all([
    read('../src/pages/Store360Page.jsx'),
    read('../src/lib/store360Service.js'),
  ]);
  assert.match(page, /function DecisionPanel/);
  assert.match(page, /الحساب نشط وعليه/);
  assert.match(page, /مطابقة كشف لمحة غير المسدد مع فواتير Zoho المفتوحة/);
  assert.match(page, /كشف لمحة غير المسدد:.*Zoho المفتوح:.*الفرق:/s);
  assert.match(page, /لا ينشئ ربطًا أو كتابة تلقائية/);
  assert.doesNotMatch(page, /لا توجد مشكلة مطابقة ظاهرة/);
  assert.match(service, /attachLamhaZohoReconciliation/);
  assert.match(service, /moneyToMinorUnits\(row\.diff\) === 0/);
  assert.match(service, /lamhaStatementBalance/);
  assert.match(service, /zohoAccountingBalance/);
  assert.match(service, /Promise\.allSettled\(\[/);
  assert.match(service, /zohoMirrorIntegrityIssue/);
  assert.match(service, /lamhaZohoReconciliationIssue/);
});

test('Store 360 uses the local Lamha mirror first and reserves live reads for explicit refresh', async () => {
  const page = await read('../src/pages/Store360Page.jsx');
  assert.match(page, /if \(refreshKey === 0\)/);
  assert.match(page, /source: 'daily-snapshot'/);
  assert.match(page, /setStatus\(snapshotStatus\)/);
  assert.match(page, /loadLamhaStoreStatus\(id\)/);
  assert.match(page, /refreshLamhaStatus/);
});
