// Persistent bank-statement ledger. The BankStatement page used to be
// purely in-memory — each upload replaced the last, so you could never
// build up a multi-period picture. This service stores every parsed
// transaction so uploads ACCUMULATE across periods.
//
// Smart merge (no double-count): each row gets a stable `dedup_key`:
//   • bank reference present  → `ref:<reference>`   (the natural unique id)
//   • no reference            → `auto:<date>|<desc>|<debit>|<credit>`
// A FULL unique index on dedup_key lets us upsert onConflict='dedup_key'
// safely (a PARTIAL index would trigger the 42P10 trap — see AGENTS.md §6).
// So re-uploading a period that overlaps a previous one merges the shared
// rows instead of duplicating them; genuinely new rows are added.

import { supabase } from './supabase.js';

const TABLE = 'bank_transactions';
const CHUNK = 500;

function dedupKeyOf(t) {
  const ref = String(t.reference ?? '').trim();
  // الاتجاه في المفتاح: التحويل المرفوض يُعاد قيده بنفس الرقم المرجعي (قيد مدين
  // + قيد دائن بنفس المرجع). بدون تمييز الاتجاه يتصادم القيدان فيُدمَجان ويُفقَد
  // أحدهما عند الحفظ. `:D` للمدين و`:C` للدائن يفصلهما.
  const dir = (Number(t.credit) || 0) > 0 ? 'C' : 'D';
  if (ref) return `ref:${ref}:${dir}`;
  // fees في المفتاح: صفوف الرسوم الخفية (بلا وصف/مرجع) مدينها 0 والمبلغ في
  // fees — بدونه تتصادم صفوف رسوم مختلفة بنفس التاريخ فتُدمَج خطأً.
  return `auto:${t.date ?? ''}|${String(t.description ?? '').slice(0, 80)}|${Number(t.debit) || 0}|${Number(t.credit) || 0}|${Number(t.fees) || 0}`;
}

// Persist a parsed statement. Returns { saved, added, merged } so the UI can
// tell the user how many rows were new vs. already-known (merged).
export async function saveBankTransactions({ transactions, summary, fileName, userId, bank = 'بنك الإنماء' }) {
  const now = new Date().toISOString();
  const rows = (transactions ?? []).map(t => ({
    dedup_key:   dedupKeyOf(t),
    bank,
    txn_date:    t.date || null,
    txn_at:      t.datetime || null,
    reference:   String(t.reference ?? '').trim() || null,
    description: t.description || null,
    debit:       Number(t.debit) || 0,
    credit:      Number(t.credit) || 0,
    fees:        Number(t.fees) || 0,
    tax:         Number(t.tax) || 0,
    source_file: fileName || null,
    period_from: summary?.periodFrom || null,
    period_to:   summary?.periodTo || null,
    created_by:  userId || null,
    updated_at:  now,
  }));
  if (!rows.length) return { saved: 0, added: 0, merged: 0 };

  // Collapse intra-file duplicates first (same key twice in one statement) —
  // keep the last occurrence so an upsert never gets two rows with one key.
  const byKey = new Map();
  for (const r of rows) byKey.set(r.dedup_key, r);
  const deduped = [...byKey.values()];
  const keys = deduped.map(r => r.dedup_key);

  // Which keys already exist → lets us report added vs merged.
  const existing = new Set();
  for (let i = 0; i < keys.length; i += CHUNK) {
    const chunk = keys.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from(TABLE).select('dedup_key').eq('bank', bank).in('dedup_key', chunk);
    if (error) throw error;
    for (const d of data ?? []) existing.add(d.dedup_key);
  }

  for (let i = 0; i < deduped.length; i += CHUNK) {
    const chunk = deduped.slice(i, i + CHUNK);
    const { error } = await supabase
      .from(TABLE).upsert(chunk, { onConflict: 'bank,dedup_key' });
    if (error) throw error;
  }

  const merged = keys.filter(k => existing.has(k)).length;
  return { saved: deduped.length, added: deduped.length - merged, merged };
}

// All saved transactions, newest first. Paginated with a stable (txn_date,id)
// order so .range() pages never overlap once the table crosses 1000 rows
// (the double-count trap from AGENTS.md §6).
export async function loadBankTransactions({ limit = 5000, bank = null } = {}) {
  const PAGE = 1000;
  const rows = [];
  let from = 0;
  while (true) {
    let q = supabase
      .from(TABLE)
      .select('id, bank, txn_date, txn_at, reference, description, debit, credit, fees, tax, source_file, period_from, period_to')
      .order('txn_date', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (bank) q = q.eq('bank', bank);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE || rows.length >= limit) break;
    from += PAGE;
  }
  return rows;
}

export async function deleteBankTransaction(id) {
  const { data, error } = await supabase
    .from(TABLE).delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('لم يُحذف أي صف (تحقّق من الصلاحيات)');
}

// Remove every row that came from one uploaded file (undo a whole upload).
export async function deleteBankUpload(sourceFile) {
  if (!sourceFile) return 0;
  const { data, error } = await supabase
    .from(TABLE).delete().eq('source_file', sourceFile).select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

// ─── استمرارية الرصيد: ملخّص كل كشف (افتتاحي/ختامي/فترة) ───
// افتتاحي كشف جديد يجب أن يطابق ختامي الكشف السابق بالهللة.
export async function loadPreviousClosing(periodFrom, bank = 'بنك الإنماء') {
  if (!periodFrom) return null;
  const { data, error } = await supabase
    .from('bank_statement_summaries')
    .select('period_from, period_to, closing_balance, file_name')
    .eq('bank', bank)
    .lt('period_to', periodFrom)
    .order('period_to', { ascending: false })
    .limit(1);
  if (error) return null;
  return data?.[0] || null;
}

// كل ملخّصات الكشوف المرفوعة (للعرض المحفوظ: الختامي/الافتتاحي لكل فترة)
export async function loadStatementSummaries(bank = null) {
  let q = supabase
    .from('bank_statement_summaries')
    .select('bank, period_from, period_to, opening_balance, closing_balance, total_debit, total_credit, file_name')
    .order('period_to', { ascending: false });
  if (bank) q = q.eq('bank', bank);
  const { data, error } = await q;
  if (error) return [];
  return data || [];
}

export async function saveStatementSummary({ periodFrom, periodTo, opening, closing, totalDebit, totalCredit, fileName, userId, bank = 'بنك الإنماء' }) {
  if (!periodFrom && !periodTo) return { ok: false };
  const { error } = await supabase.from('bank_statement_summaries').upsert({
    bank,
    period_from: periodFrom || null, period_to: periodTo || null,
    opening_balance: opening ?? null, closing_balance: closing ?? null,
    total_debit: totalDebit ?? null, total_credit: totalCredit ?? null,
    file_name: fileName || null, created_by: userId ?? null,
  }, { onConflict: 'bank,period_from,period_to' });
  if (error) throw error;
  return { ok: true };
}

// قائمة البنوك + رصيد كل بنك (ختامي آخر كشف) + الإجمالي — لعرض متعدد البنوك.
export async function loadBankList() {
  const summaries = await loadStatementSummaries();
  const byBank = new Map();
  for (const s of summaries) {
    const b = s.bank || 'بنك الإنماء';
    // الأحدث فترةً لكل بنك (summaries مرتّبة period_to تنازلياً → أول ظهور = الأحدث)
    if (!byBank.has(b)) byBank.set(b, { bank: b, closing: Number(s.closing_balance) || 0, asOf: s.period_to });
  }
  const banks = [...byBank.values()];
  const total = banks.reduce((sum, b) => sum + (b.closing || 0), 0);
  return { banks, total };
}
