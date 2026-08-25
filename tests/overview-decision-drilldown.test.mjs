import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const commandCenter = await readFile(new URL('../src/components/operations/FigmaCommandCenter.jsx', import.meta.url), 'utf8');
const customerMoney = await readFile(new URL('../src/pages/CustomerMoney.jsx', import.meta.url), 'utf8');
const lamhaReview = await readFile(new URL('../src/components/LamhaFinancialAccountReview.jsx', import.meta.url), 'utf8');

test('overview decision cards open explicit, returnable result drill-downs', () => {
  assert.match(commandCenter, /customer-money\?decision=stop&returnTo=%2Foverview/);
  assert.match(commandCenter, /customer-money\?decision=deduct&returnTo=%2Foverview/);
  assert.match(customerMoney, /decisionKey\(searchParams\.get\('decision'\)\)/);
  assert.match(customerMoney, /loadAllCustomerReceivablesRows/);
  assert.match(customerMoney, /customerDecisionMatch/);
  assert.match(customerMoney, /source: 'overview-decision'/);
});

test('opening decision results is read-only and Lamha mutation remains a reviewed second step', () => {
  assert.match(customerMoney, /فتح النتائج للقراءة فقط ولا ينفذ خصمًا أو إيقافًا/);
  assert.match(customerMoney, /فحص حالة لمحة ومراجعة الإيقاف/);
  assert.match(customerMoney, /<LamhaFinancialAccountReview initialView="overdue"/);
  assert.match(lamhaReview, /initialView = 'all'/);
  assert.doesNotMatch(customerMoney, /runLamhaStoreOperation/);
});

