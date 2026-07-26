// Bank balance tracking — manual ledger entry.
//
// The operator opens /overview, sees the cash position, and clicks
// "تحديث رصيد البنك" to enter the current bank balance whenever
// they check their account. Each update appends a new row to
// bank_balance_log so we get a history sparkline + audit trail.
//
// Public API:
//   loadCurrentBalance()  → { balance, recordedAt, notes, ... } | null
//   setBalance({ balance, notes, userId })
//   listHistory({ limit })
//
// Intentionally minimal — no bank-API integration, no statement
// parsing. Just a manual entry the operator owns.

import { supabase } from './supabase.js';

export async function loadCurrentBalance() {
  const { data, error } = await supabase
    .from('bank_balance_log')
    .select('*')
    .order('recorded_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const r = data?.[0];
  if (!r) return null;
  return {
    balance:    Number(r.balance) || 0,
    notes:      r.notes,
    recordedAt: r.recorded_at,
  };
}

// الرصيد الفعّال — نقطة الحقيقة الوحيدة (فحص وكلاء 2026-07-03: الرئيسية
// كانت تحسم كشف-مقابل-يدوي بينما /forecast يقرأ اليدوي فقط — وهو فارغ —
// فيختفي التنبؤ رغم وجود ختامي كشف). المنطق: الأحدث تاريخاً يفوز بين
// ختامي آخر كشف مرفوع (bank_statement_summaries) والإدخال اليدوي.
// يرجع { balance, source: 'statement'|'manual', asOf, notes } أو null.
export async function loadEffectiveBankBalance() {
  // متعدد البنوك (§2026-07-27): رصيد الكشوف = مجموع ختامي آخر كشف لكل بنك (لا بنك
  // واحد). أحدث فترة عبر البنوك تحدّد asOf. اليدوي يبقى بديلاً حين لا كشوف.
  const [manual, summaries] = await Promise.all([
    loadCurrentBalance().catch(() => null),
    supabase.from('bank_statement_summaries')
      .select('bank, period_to, closing_balance')
      .order('period_to', { ascending: false })
      .then(r => r.data || []).catch(() => []),
  ]);
  // ختامي آخر كشف لكل بنك (summaries مرتّبة تنازلياً → أول ظهور = الأحدث)
  const byBank = new Map();
  for (const s of summaries) {
    const b = s.bank || 'بنك الإنماء';
    if (!byBank.has(b)) byBank.set(b, { closing: Number(s.closing_balance) || 0, asOf: s.period_to });
  }
  const banks = [...byBank.entries()].map(([bank, v]) => ({ bank, ...v }));
  const stmtTotal = banks.reduce((sum, b) => sum + b.closing, 0);
  const latestAsOf = banks.reduce((mx, b) => (b.asOf && (!mx || b.asOf > mx) ? b.asOf : mx), null);

  const manualDate = manual?.recordedAt ? new Date(manual.recordedAt).getTime() : -1;
  const stmtDate   = latestAsOf ? new Date(latestAsOf).getTime() : -1;
  if (banks.length && stmtDate >= manualDate) {
    return {
      balance: stmtTotal, source: 'statement', asOf: latestAsOf,
      notes: banks.length > 1 ? `مجموع ${banks.length} بنوك (ختامي آخر كشف لكل بنك)` : `الرصيد الختامي لكشف ${latestAsOf}`,
      banks,
    };
  }
  if (manual) return { balance: manual.balance, source: 'manual', asOf: manual.recordedAt, notes: manual.notes };
  return null;
}

export async function setBalance({ balance, notes = null, userId = null }) {
  const n = Number(balance);
  if (!Number.isFinite(n)) throw new Error('قيمة الرصيد غير صالحة');
  const { data, error } = await supabase
    .from('bank_balance_log')
    .insert({
      balance:      n,
      notes:        notes?.trim() || null,
      recorded_by:  userId || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listBalanceHistory({ limit = 30 } = {}) {
  const { data, error } = await supabase
    .from('bank_balance_log')
    .select('*')
    .order('recorded_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(r => ({
    id:         r.id,
    balance:    Number(r.balance) || 0,
    notes:      r.notes,
    recordedAt: r.recorded_at,
    recordedBy: r.recorded_by,
  }));
}
