// أرصدة البنوك — كل حساب مستقل، والإجمالي هو مجموع أحدث رصيد موثوق لكل بنك.
//
// مصدر الرصيد لكل بنك:
//   1) آخر كشف مرفوع لذلك البنك.
//   2) آخر إدخال يدوي لذلك البنك.
// يفوز الأحدث زمنياً داخل البنك نفسه. لا يجوز لإدخال يدوي لبنك واحد أن
// يستبدل إجمالي بقية البنوك.

import { supabase } from './supabase.js';

const cleanBankName = (value) => String(value || '').trim();
const finiteAmount = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
};
const dateValue = (value) => {
  if (!value) return -1;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : -1;
};

const mapManual = (row) => ({
  bank: cleanBankName(row.bank) || 'بنك الإنماء',
  balance: finiteAmount(row.balance),
  notes: row.notes,
  asOf: row.recorded_at,
  recordedAt: row.recorded_at,
  source: 'manual',
});

// دالة نقية قابلة للاختبار: تبني وضع البنوك من الصفوف المقروءة فقط.
// القيمة الفارغة في أحدث كشف لا تعني صفراً. وجود بنك واحد بلا رصيد ختامي
// يجعل الإجمالي «غير مكتمل» حتى لا يدخل رقم مخترع في المتاح الفعلي.
export function summarizeEffectiveBankBalance(manualRows = [], statementRows = []) {
  const latestManual = new Map();
  for (const row of manualRows) {
    const item = mapManual(row);
    if (!latestManual.has(item.bank)) latestManual.set(item.bank, item);
  }

  const latestStatement = new Map();
  for (const row of statementRows) {
    const bank = cleanBankName(row.bank) || 'بنك الإنماء';
    if (!latestStatement.has(bank)) {
      const balance = finiteAmount(row.closing_balance);
      latestStatement.set(bank, {
        bank,
        balance,
        closing: balance,
        notes: balance == null ? 'أحدث كشف لا يحتوي رصيدًا ختاميًا صالحًا' : null,
        asOf: row.period_to,
        source: 'statement',
        valid: balance != null,
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
    .map(item => ({ ...item, valid: finiteAmount(item.balance) != null }))
    .sort((a, b) => Math.abs(finiteAmount(b.balance) || 0) - Math.abs(finiteAmount(a.balance) || 0));

  if (!banks.length) return null;

  const missingBanks = banks.filter(bank => !bank.valid).map(bank => bank.bank);
  const complete = missingBanks.length === 0;
  const sources = new Set(banks.map(bank => bank.source));
  const latestAsOf = banks.reduce(
    (latest, bank) => dateValue(bank.asOf) > dateValue(latest) ? bank.asOf : latest,
    null,
  );
  const knownBalance = banks.reduce((sum, bank) => sum + (finiteAmount(bank.balance) || 0), 0);

  return {
    balance: complete ? +knownBalance.toFixed(2) : null,
    knownBalance: +knownBalance.toFixed(2),
    complete,
    expectedCount: banks.length,
    missingBanks,
    source: sources.size === 1 ? banks[0].source : 'mixed',
    asOf: latestAsOf,
    notes: complete
      ? `إجمالي ${banks.length} ${banks.length === 1 ? 'بنك مسجّل' : 'بنوك مسجّلة'}`
      : `الرصيد غير مكتمل: ${missingBanks.join('، ')} بلا رصيد ختامي صالح`,
    banks,
  };
}

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

  return summarizeEffectiveBankBalance(manualResult.data || [], statementResult.data || []);
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
    balance: finiteAmount(row.balance),
    notes: row.notes,
    recordedAt: row.recorded_at,
    recordedBy: row.recorded_by,
  }));
}
