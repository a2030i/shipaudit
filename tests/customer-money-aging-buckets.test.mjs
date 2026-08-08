import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/pages/CustomerMoney.jsx', import.meta.url), 'utf8');
const service = await readFile(new URL('../src/lib/pnlService.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260808160000_split_customer_money_recent_aging.sql', import.meta.url), 'utf8');

test('customer collection exposes independent 0–15 and 16–30 filters', () => {
  assert.match(page, /key: 'b0_15', label: '0–15 يوم'/);
  assert.match(page, /key: 'b16_30', label: '16–30 يوم'/);
  assert.match(page, /'0-15', '16-30', '31-60'/);
  assert.match(page, /c\.b0_15, c\.b16_30, c\.b1/);
});

test('dashboard adapter maps both recent aging buckets', () => {
  assert.match(service, /b0_15: Number\(d\.aging\?\.b0_15\)/);
  assert.match(service, /b16_30: Number\(d\.aging\?\.b16_30\)/);
  assert.match(service, /b0_15: Number\(c\.b0_15\)/);
  assert.match(service, /b16_30: Number\(c\.b16_30\)/);
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
