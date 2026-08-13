import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAlinmaFormat } from '../src/engine/bankStatementProcessor.js';

test('splits Alinma signed amount column and carries merged transaction dates', () => {
  const rows = [
    ['Balance', 'Credit/Debit', 'Transaction Description', 'Reference', 'Transaction Date'],
    [900, -100, 'Outgoing transfer', 'FT-1', 46023],
    [950, 50, 'Incoming transfer', 'FT-2', null],
  ];
  const colMap = {
    headerRow: 0,
    creditCol: 1,
    debitCol: 1,
    descCol: 2,
    refCol: 3,
    dateCol: 4,
  };

  const { transactions } = parseAlinmaFormat(rows, colMap);
  const debit = transactions.find(row => row.reference === 'FT-1');
  const credit = transactions.find(row => row.reference === 'FT-2');

  assert.equal(debit.debit, 100);
  assert.equal(debit.credit, null);
  assert.equal(credit.credit, 50);
  assert.equal(credit.debit, null);
  assert.equal(credit.date, debit.date);
  assert.match(credit.date, /^\d{4}-\d{2}-\d{2}$/);
});
