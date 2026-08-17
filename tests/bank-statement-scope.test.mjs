import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bankPeriodOptions,
  bankTransactionTotals,
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

test('cancelled and returned transfers stay visible but do not inflate fees or totals', () => {
  const rows = [
    { debit: 692.5, credit: 0, fees: 50, tax: 7.5, rejected: true },
    { debit: 0, credit: 750, fees: 0, tax: 0, rejected: true },
    { debit: 500, credit: 0, fees: 536, tax: 80.4 },
  ];

  assert.deepEqual(bankTransactionTotals(rows), {
    count: 1,
    debit: 1116.4,
    credit: 0,
    fees: 616.4,
  });
});

test('closing balance is calculated at the selected end inside a longer statement', () => {
  const juneStatement = {
    bank: 'بنك الإنماء', period_from: '2026-06-01', period_to: '2026-07-04',
    opening_balance: 157924.04, closing_balance: 142220.99,
  };
  const rows = [
    { bank: 'بنك الإنماء', txn_date: '2026-06-15', period_from: '2026-06-01', period_to: '2026-07-04', credit: 1000, debit: 0, fees: 0, tax: 0 },
    { bank: 'بنك الإنماء', txn_date: '2026-06-30', period_from: '2026-06-01', period_to: '2026-07-04', credit: 0, debit: 200, fees: 10, tax: 1.5 },
    { bank: 'بنك الإنماء', txn_date: '2026-07-02', period_from: '2026-06-01', period_to: '2026-07-04', credit: 0, debit: 500, fees: 0, tax: 0 },
  ];

  const closing = findBankPeriodClosing({
    summaries: [juneStatement], transactions: rows, bank: 'بنك الإنماء',
    from: '2026-06-01', to: '2026-06-30',
  });

  assert.equal(closing.closing_balance, 158712.54);
  assert.equal(closing.period_to, '2026-06-30');
  assert.equal(closing.calculated_for_selected_period, true);
});

test('as-of closing can come from the latest verified statement before a narrow range', () => {
  const closing = findBankPeriodClosing({
    summaries: [
      { bank: 'بنك الإنماء', period_from: '2026-05-01', period_to: '2026-05-31', closing_balance: 120 },
      { bank: 'بنك الإنماء', period_from: '2026-07-01', period_to: '2026-07-31', closing_balance: 180 },
    ],
    bank: 'بنك الإنماء', from: '2026-06-10', to: '2026-06-20',
  });

  assert.equal(closing.closing_balance, 120);
});
