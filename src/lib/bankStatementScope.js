export const DEFAULT_BANK_NAME = 'بنك الإنماء';

export const bankNameOf = (row) => row?.bank || DEFAULT_BANK_NAME;

export function rowsForBank(rows, bank) {
  if (!bank || bank === 'all') return rows || [];
  return (rows || []).filter(row => bankNameOf(row) === bank);
}

export function selectedBankName(bank, bankSummary = []) {
  if (bank && bank !== 'all') return bank;
  return bankSummary.length === 1 ? bankSummary[0].bank : null;
}

export function bankTransactionTotals(rows, { excludeRejected = true } = {}) {
  const list = (rows || []).filter(row => !excludeRejected || !row?.rejected);
  return {
    count: list.length,
    debit: list.reduce((sum, row) => sum
      + (Number(row?.debit) || 0)
      + (Number(row?.fees) || 0)
      + (Number(row?.tax) || 0), 0),
    credit: list.reduce((sum, row) => sum + (Number(row?.credit) || 0), 0),
    fees: list.reduce((sum, row) => sum
      + (Number(row?.fees) || 0)
      + (Number(row?.tax) || 0), 0),
  };
}

export function findBankPeriodClosing({ summaries, transactions = [], bank, from, to }) {
  if (!bank || !to) return null;
  const d = value => String(value || '').slice(0, 10);
  const scoped = (summaries || []).filter(row => bankNameOf(row) === bank);
  const exact = scoped.find(row => d(row.period_from) === from && d(row.period_to) === to);
  if (exact) return exact;

  // The user's date range may stop inside an uploaded statement (for example
  // 1–30 June while the bank export itself runs through 4 July). In that case
  // derive the balance at the selected end date from the statement opening and
  // every bank movement up to that date. Rejected pairs are intentionally kept
  // here: before the return date they still affect the real bank balance.
  const covering = scoped
    .filter(row => row.opening_balance != null && d(row.period_from) <= to && d(row.period_to) >= to)
    .sort((a, b) => d(b.period_from).localeCompare(d(a.period_from)))[0];
  if (covering) {
    const statementFrom = d(covering.period_from);
    const statementTo = d(covering.period_to);
    const movement = rowsForBank(transactions, bank).filter(row => {
      const txnDate = d(row.txn_date || row.date);
      const rowFrom = d(row.period_from);
      const rowTo = d(row.period_to);
      const belongsToStatement = (!rowFrom && !rowTo)
        || (rowFrom === statementFrom && rowTo === statementTo);
      return belongsToStatement && txnDate >= statementFrom && txnDate <= to;
    });
    if (movement.length) {
      const totals = bankTransactionTotals(movement, { excludeRejected: false });
      return {
        ...covering,
        period_to: to,
        closing_balance: +(Number(covering.opening_balance) + totals.credit - totals.debit).toFixed(2),
        calculated_for_selected_period: true,
        source_period_to: statementTo,
      };
    }
  }

  // If the selected end falls between statements, the latest verified closing
  // on or before that date is still the correct as-of balance. Do not constrain
  // it to start inside the filter: a closing balance is cumulative by nature.
  return scoped
    .filter(row => d(row.period_to) <= to)
    .sort((a, b) => d(b.period_to).localeCompare(d(a.period_to)))[0] || null;
}

export function bankPeriodOptions(rows, bank) {
  const seen = new Map();
  for (const row of rowsForBank(rows, bank)) {
    if (!row.period_from || !row.period_to) continue;
    const from = String(row.period_from).slice(0, 10);
    const to = String(row.period_to).slice(0, 10);
    const key = `${from}→${to}`;
    if (!seen.has(key)) seen.set(key, { from, to });
  }
  return [...seen.values()].sort((a, b) => b.to.localeCompare(a.to));
}
