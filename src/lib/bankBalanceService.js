// أرصدة البنوك — كل حساب مستقل، والإجمالي هو مجموع أحدث رصيد موثوق لكل بنك.
//
// مصدر الرصيد لكل بنك:
//   1) آخر كشف مرفوع لذلك البنك.
//   2) آخر إدخال يدوي لذلك البنك.
// يفوز الأحدث زمنياً داخل البنك نفسه. لا يجوز لإدخال يدوي لبنك واحد أن
// يستبدل إجمالي بقية البنوك.

import { supabase } from './supabase.js';

const cleanBankName = (value) => String(value || '').trim();
const dateValue = (value) => {
  if (!value) return -1;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : -1;
};

const mapManual = (row) => ({
  bank: cleanBankName(row.bank) || 'بنك الإنماء',
  balance: Number(row.balance) || 0,
  notes: row.notes,
  asOf: row.recorded_at,
  recordedAt: row.recorded_at,
  source: 'manual',
});

export async function loadCurrentBalance(bank = null) {
  let query = supabase
    .from('bank_balance_log')
    .select('bank, balance, notes, recorded_at')
    .order('recorded_at', { ascending: false })
    .limit(1);

  if (cleanBankName(bank)) query = query.eq('bank', cleanBankName(bank));

  const { data, error } = await query;
  if (error) throw error;
  return data?.[0] ? mapManual(data[0]) : null;
}

export async function loadEffectiveBankBalance() {
  const [manualResult, statementResult] = await Promise.all([
    supabase
      .from('bank_balance_log')
      .select('bank, balance, notes, recorded_at')
      .order('recorded_at', { ascending: false }),
    supabase
      .from('bank_statement_summaries')
      .select('bank, period_to, closing_balance')
      .order('period_to', { ascending: false }),
  ]);

  if (manualResult.error) throw manualResult.error;
  if (statementResult.error) throw statementResult.error;

  const latestManual = new Map();
  for (const row of manualResult.data || []) {
    const item = mapManual(row);
    if (!latestManual.has(item.bank)) latestManual.set(item.bank, item);
  }

  const latestStatement = new Map();
  for (const row of statementResult.data || []) {
    const bank = cleanBankName(row.bank) || 'بنك الإنماء';
    if (!latestStatement.has(bank)) {
      latestStatement.set(bank, {
        bank,
        balance: Number(row.closing_balance) || 0,
        closing: Number(row.closing_balance) || 0,
        notes: null,
        asOf: row.period_to,
        source: 'statement',
      });
    }
  }

  const names = new Set([...latestStatement.keys(), ...latestManual.keys()]);
  const banks = [...names]
    .map((bank) => {
      const statement = latestStatement.get(bank);
      const manual = latestManual.get(bank);
      if (!statement) return manual;
      if (!manual) return statement;
      return dateValue(manual.asOf) > dateValue(statement.asOf) ? manual : statement;
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

  if (!banks.length) return null;

  const sources = new Set(banks.map(b => b.source));
  const latestAsOf = banks.reduce(
    (latest, bank) => dateValue(bank.asOf) > dateValue(latest) ? bank.asOf : latest,
    null,
  );

  return {
    balance: banks.reduce((sum, bank) => sum + bank.balance, 0),
    source: sources.size === 1 ? banks[0].source : 'mixed',
    asOf: latestAsOf,
    notes: `إجمالي ${banks.length} ${banks.length === 1 ? 'بنك مسجّل' : 'بنوك مسجّلة'}`,
    banks,
  };
}

export async function setBalance({ bank, balance, notes = null, userId = null }) {
  const bankName = cleanBankName(bank);
  const amount = Number(balance);
  if (!bankName) throw new Error('اسم البنك مطلوب');
  if (!Number.isFinite(amount)) throw new Error('قيمة الرصيد غير صالحة');

  const { data, error } = await supabase
    .from('bank_balance_log')
    .insert({
      bank: bankName,
      balance: amount,
      notes: notes?.trim() || null,
      recorded_by: userId || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listBalanceHistory({ bank = null, limit = 30 } = {}) {
  let query = supabase
    .from('bank_balance_log')
    .select('*')
    .order('recorded_at', { ascending: false })
    .limit(limit);

  if (cleanBankName(bank)) query = query.eq('bank', cleanBankName(bank));

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(row => ({
    id: row.id,
    bank: cleanBankName(row.bank) || 'بنك الإنماء',
    balance: Number(row.balance) || 0,
    notes: row.notes,
    recordedAt: row.recorded_at,
    recordedBy: row.recorded_by,
  }));
}
