import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { annotateRejected, generateCleanExcel } from '../src/engine/bankStatementProcessor.js';

test('a card refund remains a valid bank transaction and is exported', () => {
  const rows = [
    {
      date: '2026-07-30', reference: '8515766', debit: 518.01, credit: 0,
      description: 'E-Commerce Payment · Card last 4 digit: 4174\nMerchant: HAWSABAH CO',
    },
    {
      date: '2026-08-02', reference: '8623699', debit: 0, credit: 518.01,
      description: 'Card Refund · Card last 4 digit: 4174\nMerchant: HAWSABAH CO',
    },
  ];

  annotateRejected(rows);
  assert.equal(rows[0].rejected, undefined);
  assert.equal(rows[1].rejected, undefined);

  const workbook = XLSX.read(generateCleanExcel(rows), { type: 'array' });
  const exported = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
  assert.equal(exported.length, 2);
  assert.equal(exported[1]['دائن'], 518.01);
});

test('only an explicit same-reference, same-amount reversal pair is marked rejected', () => {
  const rows = [
    { date: '2026-08-01', reference: 'FT-100', debit: 750, credit: 0, description: 'Outgoing transfer' },
    { date: '2026-08-01', reference: 'FT-100', debit: 0, credit: 750, description: 'تم رفض التحويل وإعادة المبلغ' },
  ];

  annotateRejected(rows);
  assert.equal(rows[0].rejected, true);
  assert.equal(rows[1].rejected, true);

  const workbook = XLSX.read(generateCleanExcel(rows), { type: 'array' });
  const exported = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
  assert.equal(exported.length, 0);
});

test('pairs a rejected transfer against its gross debit including fees and VAT', () => {
  const rows = [
    {
      date: '2026-08-01', reference: 'FT-101', debit: 692.5, credit: 0,
      fees: 50, tax: 7.5, feesRemoved: 57.5, description: 'Outgoing SWIFT transfer',
    },
    {
      date: '2026-08-02', reference: 'FT-101', debit: 0, credit: 750,
      description: 'Rejected transfer and amount returned',
    },
  ];

  annotateRejected(rows);
  assert.equal(rows[0].rejected, true);
  assert.equal(rows[1].rejected, true);
});

test('an unmatched reversal-looking credit is not hidden', () => {
  const rows = [
    { date: '2026-08-01', reference: 'RETURN-ONLY', debit: 0, credit: 99, description: 'Reversal credit' },
  ];

  annotateRejected(rows);
  assert.equal(rows[0].rejected, undefined);
});
