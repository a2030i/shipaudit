// ─────────────────────────────────────────────────────────────────────────────
//  Monthly per-carrier report
//
//  Aggregates the carrier ledger (carrier_operations) + audits into a
//  per-carrier-per-month summary: مفوتر · تحصيل COD · إشعارات دائنة · مدفوعات ·
//  صافي الحركة · مراجعات + فروقاتها.
//
//  Carrier-id normalisation: Aramex COD remittances were uploaded under the
//  slug `aramex` while its ledger lives under `c_1777506662790`. We fold the
//  alias so a carrier shows as ONE row, never split across two ids.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from './supabase.js';

const ALIAS = { aramex: 'c_1777506662790' };
const canon = (id) => ALIAS[id] || id;

const monthOf = (s) => (s ? String(s).slice(0, 7) : '');
const isMonth = (s) => /^\d{4}-\d{2}/.test(String(s || ''));

// Load a whole (small) table with a stable order so pages never overlap.
async function loadAll(table, columns) {
  const PAGE = 1000;
  let from = 0, out = [];
  for (;;) {
    const { data, error } = await supabase
      .from(table).select(columns)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out = out.concat(data || []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

const n = (v) => Number(v) || 0;

export async function loadMonthlyReport() {
  const [ops, audits, carriers, payments] = await Promise.all([
    loadAll('carrier_operations', 'id, carrier_id, doc_type, amount_dr, amount_cr, doc_date, created_at'),
    loadAll('audits', 'id, carrier_id, carrier_name, period, created_at, total_expected, total_billed, diff, mismatch_count, review_status'),
    supabase.from('carriers').select('id, name').then(r => r.data || []),
    // المدفوعات مصدرها جدول payments (createPaymentRecord) لا قيود PAY في
    // carrier_operations (لا يكتبها أحد — كان العمود يظهر 0 رغم دفعات
    // أرامكس 164,003؛ فحص الوكلاء #9). جدول payments = المصدر الوحيد.
    loadAll('payments', 'id, carrier_id, amount, paid_at, created_at'),
  ]);

  const nameById = new Map(carriers.map(c => [c.id, c.name]));
  const cell = new Map(); // `${month}|${carrierId}` → row

  const get = (month, carrierId) => {
    const key = `${month}|${carrierId}`;
    let r = cell.get(key);
    if (!r) {
      r = {
        month, carrierId,
        carrierName: nameById.get(carrierId) || carrierId,
        billed: 0, crTotal: 0, cod: 0, creditNotes: 0, payments: 0,
        auditCount: 0, auditExpected: 0, auditBilled: 0, auditDiff: 0, mismatch: 0,
      };
      cell.set(key, r);
    }
    return r;
  };

  // ── Ledger operations ──
  for (const op of ops) {
    const month = monthOf(op.doc_date || op.created_at);
    if (!month) continue;
    const r = get(month, canon(op.carrier_id));
    const dr = n(op.amount_dr), cr = n(op.amount_cr);
    r.billed   += dr;
    r.crTotal  += cr;
    if (op.doc_type === 'COD')                       r.cod         += cr;
    else if (op.doc_type === 'DG' || op.doc_type === 'AB') r.creditNotes += cr;
    else if (op.doc_type === 'PAY')                  r.payments    += cr;
  }

  // ── Payments (from the payments table — the real source) ──
  // نضيفها للعمود وللـcrTotal (فتدخل «صافي الحركة») تماماً كما كانت قيود
  // PAY ستفعل لو كانت تُكتَب. المصدر واحد فلا ازدواج (لا قيود PAY تُكتَب).
  for (const p of payments) {
    const month = monthOf(p.paid_at || p.created_at);
    if (!month) continue;
    const r = get(month, canon(p.carrier_id));
    const amt = n(p.amount);
    r.payments += amt;
    r.crTotal  += amt;
  }

  // ── Audits (quality: how much was reviewed + diffs) ──
  for (const a of audits) {
    if (a.review_status === 'rejected') continue;
    const month = isMonth(a.period) ? monthOf(a.period) : monthOf(a.created_at);
    if (!month) continue;
    const r = get(month, canon(a.carrier_id));
    r.auditCount    += 1;
    r.auditExpected += n(a.total_expected);
    r.auditBilled   += n(a.total_billed);
    r.auditDiff     += n(a.diff);
    r.mismatch      += n(a.mismatch_count);
  }

  const rows = [...cell.values()].map(r => ({
    ...r,
    net: +(r.billed - r.crTotal).toFixed(2),
    billed: +r.billed.toFixed(2),
    cod: +r.cod.toFixed(2),
    creditNotes: +r.creditNotes.toFixed(2),
    payments: +r.payments.toFixed(2),
    auditExpected: +r.auditExpected.toFixed(2),
    auditBilled: +r.auditBilled.toFixed(2),
    auditDiff: +r.auditDiff.toFixed(2),
  }));

  const months = [...new Set(rows.map(r => r.month))].sort().reverse();
  return { months, rows };
}
