import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  decisionAccountOperatingState, matchesWalletInvoiceDecisionFilters,
} from '../src/lib/lamhaDecisionActions.js';
import { summarizeLamhaWalletSources } from '../src/lib/lamhaStoreProfileService.js';

const customer = {
  billingType: 'دفع مسبق', walletBalance: 50, owed: 100, invCnt: 2, platformStatus: 'idle',
};

test('wallet and invoice decision defaults are strict and independently filterable', () => {
  assert.equal(matchesWalletInvoiceDecisionFilters(customer), true);
  assert.equal(matchesWalletInvoiceDecisionFilters({ ...customer, walletBalance: 0.5 }), false);
  assert.equal(matchesWalletInvoiceDecisionFilters({ ...customer, walletBalance: 0.51 }), true);
  assert.equal(matchesWalletInvoiceDecisionFilters({ ...customer, owed: 0.5 }), false);
  assert.equal(matchesWalletInvoiceDecisionFilters({ ...customer, invCnt: 0 }), false);
  assert.equal(matchesWalletInvoiceDecisionFilters(customer, { billing: 'postpaid' }), false);
  assert.equal(matchesWalletInvoiceDecisionFilters(customer, { billing: 'all', walletMin: 20, dueMin: 90, invoices: 'open' }), true);
});

test('Lamha operating filter follows the inactive-only account rule', () => {
  assert.equal(decisionAccountOperatingState({ platformStatus: 'idle' }), 'operating');
  assert.equal(decisionAccountOperatingState({ platformStatus: 'stopped' }), 'operating');
  assert.equal(decisionAccountOperatingState({ platformStatus: 'inactive' }), 'stopped');
  assert.equal(matchesWalletInvoiceDecisionFilters(customer, { account: 'operating' }), true);
  assert.equal(matchesWalletInvoiceDecisionFilters(customer, { account: 'stopped' }), false);
  assert.equal(decisionAccountOperatingState(customer, { ok: true, store: { canCreateShipments: false } }), 'stopped');
});

test('wallet provenance summary uses the real Excel import time and reports missing sources', () => {
  const summary = summarizeLamhaWalletSources([
    { walletSource: 'excel', walletImportedAt: '2026-08-28T16:00:35Z', walletSourceFile: 'stores.xlsx' },
    { walletSource: 'excel', walletImportedAt: '2026-08-28T16:00:22Z', walletSourceFile: 'stores.xlsx' },
    { walletSource: 'unavailable' },
  ]);
  assert.equal(summary.availableCount, 2);
  assert.equal(summary.missingCount, 1);
  assert.equal(summary.oldestImportedAt, '2026-08-28T16:00:22.000Z');
  assert.equal(summary.sourceFile, 'stores.xlsx');
});

test('decision UI exposes every criterion and preserves source provenance', async () => {
  const [page, resultSet, migration] = await Promise.all([
    readFile(new URL('../src/pages/CustomerMoney.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/operations/OperationalResultSet.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260829000659_lamha_store_profile_sources_batch.sql', import.meta.url), 'utf8'),
  ]);
  assert.match(page, /نوع الدفع/);
  assert.match(page, /رصيد المحفظة أكبر من/);
  assert.match(page, /القابل للتحصيل أكبر من/);
  assert.match(page, /لديه فواتير مفتوحة/);
  assert.match(page, /تشغيل حساب لمحة/);
  assert.match(page, /الفواتير: Zoho Books/);
  assert.match(page, /المحفظة: ملف لمحة Excel/);
  assert.match(page, /يُعاد التحقق حيًا قبل الإيقاف/);
  assert.match(resultSet, /sourceDetails/);
  assert.match(migration, /security definer/);
  assert.match(migration, /crm_has_permission\('receivables\.view'\)/);
  assert.match(migration, /revoke all on function public\.lamha_store_profile_sources/);
  assert.doesNotMatch(migration, /walletBalance'\s*,\s*profile\.excel_data/);
});
