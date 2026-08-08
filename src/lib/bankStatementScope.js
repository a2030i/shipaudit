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

export function findBankPeriodClosing({ summaries, bank, from, to }) {
  if (!bank || !to) return null;
  const d = value => String(value || '').slice(0, 10);
  const scoped = (summaries || []).filter(row => bankNameOf(row) === bank);
  const exact = scoped.find(row => d(row.period_from) === from && d(row.period_to) === to);
  if (exact) return exact;
  return scoped
    .filter(row => d(row.period_to) <= to && (!from || d(row.period_to) >= from))
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
