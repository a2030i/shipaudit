import assert from 'node:assert/strict';
import test from 'node:test';

import { extractSummaryFromRows } from '../src/engine/bankStatementProcessor.js';

test('reads Bank Alinma currency-wrapped closing balance', () => {
  const rows = [
    ['SAR 227908.66', null, null, null, 'رصيد الإقفال'],
  ];

  const summary = extractSummaryFromRows(rows, rows.length);

  assert.equal(summary.closingBalance, 227908.66);
});

test('reads Bank Alinma amount-before-parenthesized-currency summary values', () => {
  const rows = [
    ['4,600,136.54 ( SAR )', null, 'Total Credit Amount'],
    ['196,337.51 ( SAR )', null, 'Closing Balance'],
  ];

  const summary = extractSummaryFromRows(rows, rows.length);

  assert.equal(summary.bankTotalCredit, 4600136.54);
  assert.equal(summary.closingBalance, 196337.51);
});

test('does not turn a date embedded in a closing-balance label into money', () => {
  const rows = [
    ['Closing Balance as of 26 Jul, 2026'],
  ];

  const summary = extractSummaryFromRows(rows, rows.length);

  assert.equal(summary.closingBalance, null);
});
