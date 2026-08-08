import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bankPeriodOptions,
  findBankPeriodClosing,
  rowsForBank,
  selectedBankName,
} from '../src/lib/bankStatementScope.js';

const transactions = [
  { bank: 'بنك الإنماء', txn_date: '2026-04-02', period_from: '2026-04-01', period_to: '2026-04-30' },
  { bank: 'بنك الإنماء', txn_date: '2026-04-03', period_from: '2026-04-01', period_to: '2026-04-30' },
  { bank: 'بنك ساي فاي', txn_date: '2026-07-15', period_from: '2026-07-14', period_to: '2026-08-05' },
];

const summaries = [
  { bank: 'بنك الإنماء', period_from: '2026-04-01', period_to: '2026-04-30', closing_balance: 273790.83 },
  { bank: 'بنك ساي فاي', period_from: '2026-07-14', period_to: '2026-08-05', closing_balance: 5805.30 },
];

test('bank selection scopes row counts and ready periods', () => {
  assert.equal(rowsForBank(transactions, 'بنك ساي فاي').length, 1);
  assert.deepEqual(bankPeriodOptions(transactions, 'بنك ساي فاي'), [
    { from: '2026-07-14', to: '2026-08-05' },
  ]);
});

test('SiFi never borrows Alinma closing balance', () => {
  assert.equal(findBankPeriodClosing({
    summaries,
    bank: 'بنك ساي فاي',
    from: '2026-04-01',
    to: '2026-04-30',
  }), null);

  assert.equal(findBankPeriodClosing({
    summaries,
    bank: 'بنك ساي فاي',
    from: '2026-07-14',
    to: '2026-08-05',
  }).closing_balance, 5805.30);
});

test('all banks has no singular balance when more than one bank exists', () => {
  assert.equal(selectedBankName('all', [{ bank: 'A' }, { bank: 'B' }]), null);
  assert.equal(selectedBankName('all', [{ bank: 'A' }]), 'A');
});
