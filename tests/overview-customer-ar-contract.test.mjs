import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const service = await readFile(new URL('../src/lib/overviewService.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../src/pages/Overview.jsx', import.meta.url), 'utf8');

test('overview effective cash uses collectible customer debt, not gross Zoho debit', () => {
  assert.match(service, /rpc\('customer_money_dashboard'\)/);
  assert.match(service, /const collectibleAr = Number\(customerMoney\?\.outstanding\)/);
  assert.match(service, /const totalAR = arFromZoho \? collectibleAr/);
  assert.match(service, /customerCreditOffset:/);
});

test('overview explains that customer credits are removed from collectible cash', () => {
  assert.match(page, /customerCreditOffset > 0\.005/);
  assert.match(page, /cash\.customerCreditOffset/);
});
