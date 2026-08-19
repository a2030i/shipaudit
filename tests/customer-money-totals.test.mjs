import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateZohoDocumentBackedBalance, calculateZohoDocumentBackedCreditOffset,
} from '../src/lib/customerMoneyTotals.js';

test('Zoho displayed balance includes documented amounts and harmless rounding only', () => {
  const rows = [
    { invoiced_due: 108621.20, opening_due: 13910.45, balance_residual: 0, balance_sync_gap: 0, unused_credits: 2573.02 },
    { invoiced_due: 0, opening_due: 0, balance_residual: 0.28, balance_sync_gap: 0.28 },
    // فجوة مادية داخلية لا تملك مستندًا مطابقًا، فلا تدخل رقم Zoho المعروض.
    { invoiced_due: 0, opening_due: 0, balance_residual: 3405.50, balance_sync_gap: 3405.50, unused_credits: 3658.50 },
  ];
  assert.equal(calculateZohoDocumentBackedBalance(rows), 122531.93);
  assert.equal(calculateZohoDocumentBackedCreditOffset(rows), 2573.02);
});

test('Zoho displayed balance is stable with numeric strings and invalid values', () => {
  assert.equal(calculateZohoDocumentBackedBalance([
    { invoiced_due: '10.10', opening_due: '2.20', balance_residual: '0.01', balance_sync_gap: '0.01' },
    { invoiced_due: null, opening_due: undefined, balance_residual: 'bad', balance_sync_gap: 'bad' },
  ]), 12.31);
});
