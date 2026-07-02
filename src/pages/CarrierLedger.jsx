import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Search, RefreshCw, Link2, FileText, Upload, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { rtl } from '../lib/xlsxRtl.js';
import { Card, Btn, Input, Select, Modal, Empty, Spinner, toast } from '../components/UI.jsx';
import CarrierTabs from '../components/CarrierTabs.jsx';
import {
  loadOperations,
  loadOpenBalance,
  loadCarriersOverview,
  setOperationStatus,
  loadStatements,
  getStatementFileUrl,
  loadLinkedAuditIndex,
  createPaymentRecord,
  loadDisputeNotes,
  openDispute,
  addDisputeNote,
  resolveDispute,
  reopenDispute,
  loadCreditCandidates,
  logActivity,
} from '../lib/carrierStatementsService.js';
import { loadCarriers, loadAuditsFromDB, saveAuditToDB, applyCrossAuditDuplicates } from '../lib/coreService.js';
import {
  detectHeaderRow, buildHeaders, detectColumns, mapRows, auditAll, buildSummary,
  deriveAuditType,
} from '../engine/audit.js';
import { aiAnalyzeFile } from '../engine/openrouter.js';
import { loadSettings } from '../data/carriers.js';
import { useAuth } from '../lib/auth.jsx';

// ─── Status meta ───────────────────────────────────────────────────────────
const STATUS_META = {
  open:      { label: '📂 مستحقة',          color: 'var(--red)'    },
  pending:   { label: '⏳ معلّقة',          color: 'var(--gold)'   },
  audited:   { label: '✓ معتمدة',          color: 'var(--accent)' },
  paid:      { label: '💰 مسدّدة',          color: 'var(--green)'  },
  partial:   { label: '🟡 مسدّدة جزئياً',   color: '#f59e0b'       },
  disputed:  { label: '⚠ متنازع',          color: 'var(--red)'    },
  reviewing: { label: '🔄 مراجعة',          color: 'var(--gold)'   },
};
const SHIPMENT_LABEL = {
  domestic:           'محلي',
  domestic_other:     'محلي (DCF)',
  international_in:   'دولي وارد',
  international_out:  'دولي صادر',
};
// Doc-type metadata. INV = invoice auto-posted on audit approval (we owe),
// RV = invoice from an uploaded carrier statement (we owe), DR = small debit
// adjustment (we owe a bit more), DG = credit note (carrier owes us / refund),
// AB = adjustment-both (a netted correction). Distinct colors so a glance
// at the ledger answers "what kind of line is this."
const DOC_TYPE_META = {
  INV: { label: 'فاتورة (مراجعة معتمدة)', icon: '🧾', color: '#8b5cf6' },
  RV: { label: 'فاتورة (كشف مرفوع)', icon: '📄', color: '#3b82f6' },
  DR: { label: 'مدين إضافي', icon: '+',  color: '#f59e0b' },
  DG: { label: 'إشعار دائن', icon: '↩',  color: 'var(--green)' },
  AB: { label: 'تعديل',       icon: '🔄', color: 'var(--muted)' },
};

// Compact legend strip — maps each doc_type code+icon to its meaning so the
// ledger's النوع column is self-explanatory. Rendered once above the table.
function DocTypeLegend() {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
      padding: '8px 12px', marginBottom: 10,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 9, fontSize: 11,
    }}>
      <span style={{ color: 'var(--muted)', fontWeight: 700, marginInlineEnd: 2 }}>دليل الأنواع:</span>
      {Object.entries(DOC_TYPE_META).map(([code, dm]) => (
        <span key={code} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          background: `${dm.color}18`, border: `1px solid ${dm.color}40`,
          color: dm.color, padding: '2px 8px', borderRadius: 12,
          fontFamily: 'var(--font-mono)', fontWeight: 700, whiteSpace: 'nowrap',
        }}>
          {dm.icon} {code} — <span style={{ fontFamily: 'inherit' }}>{dm.label}</span>
        </span>
      ))}
    </div>
  );
}

// Visual metadata for the per-row shipment-type badge. `domestic_other` is
// the Aramex DCF/COD invoice class — we colour it differently so the user
// can spot COD-fee lines at a glance, since the math (5 SAR flat) and the
// audit type are completely different from regular shipping.
const SHIPMENT_META = {
  domestic:          { label: 'محلي',        icon: '🇸🇦', color: '#22c55e' },
  domestic_other:    { label: 'COD محلي',    icon: '💰', color: '#a855f7' },
  international_in:  { label: 'دولي وارد',   icon: '✈️', color: '#f59e0b' },
  international_out: { label: 'دولي صادر',   icon: '✈️', color: '#f59e0b' },
};
const fmt = n => (n == null || Number.isNaN(n))
  ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CarrierLedger({ isActive = true }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [carrier, setCarrier] = useState(() => searchParams.get('carrier') || '');
  const [carrierList, setCarrierList] = useState([]);
  const [ops, setOps] = useState([]);
  const [bal, setBal] = useState(null);
  const [statements, setStatements] = useState([]);
  const [loading, setLoading] = useState(true);
  // ?doc=XXX (deep-link from Audits History) seeds the search box so the
  // linked op is immediately visible in the table.
  const [search, setSearch]   = useState(() => searchParams.get('doc') || '');
  const [statusFilter, setStatusFilter] = useState('all');
  const [shipmentFilter, setShipmentFilter] = useState('all');
  const [modal, setModal] = useState(null); // { op, action: 'paid'|'dispute' } or { ops, action:'bulk-paid' }
  // Bulk selection: Set<opId> for checkbox-driven multi-pay. Cleared on
  // carrier change, after a bulk action, or on filter changes that would
  // hide selected rows (we just reset to keep mental model simple).
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // Sync carrier param ↔ URL (preserve ?doc= when present so the deep-link is
  // shareable / refreshable).
  useEffect(() => {
    const next = {};
    if (carrier) next.carrier = carrier;
    const doc = searchParams.get('doc');
    if (doc) next.doc = doc;
    setSearchParams(next, { replace: true });
  }, [carrier]); // eslint-disable-line

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Discover carriers that have operations (so the dropdown is data-driven)
      const overview = await loadCarriersOverview();
      setCarrierList(overview);

      // Default carrier = whichever has the highest outstanding (or fall back
      // to first in list, or 'aramex' for backwards compatibility).
      const effective = carrier
        || overview[0]?.carrierId
        || 'aramex';
      if (!carrier) setCarrier(effective);

      const [opsData, balData, stmtsData] = await Promise.all([
        loadOperations({ carrierId: effective }),
        loadOpenBalance(effective),
        loadStatements(effective, 12),
      ]);
      setOps(opsData);
      setBal(balData);
      setStatements(stmtsData);
    } catch (e) {
      toast(`خطأ في التحميل: ${e.message}`, 'error');
    }
    setLoading(false);
  }, [carrier]);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh]);

  // Drop the bulk selection whenever the carrier changes — the IDs are
  // scoped to the previous carrier's ops and would silently apply to
  // nothing on the new view.
  useEffect(() => { setSelectedIds(new Set()); }, [carrier]);

  const filtered = useMemo(() => ops.filter(o => {
    // Synthetic filters:
    // 'unaudited'    → open RV invoices not yet linked to an audit
    //                  (still need to be audited BEFORE paying)
    // 'paid_unaudited' → RV invoices that were already paid without
    //                  an audit attached. These are easy to forget —
    //                  the user paid against the statement but never
    //                  reconciled the per-shipment file. Surfacing
    //                  them keeps the audit trail complete.
    if (statusFilter === 'unaudited') {
      if (o.doc_type !== 'RV' || o.audit_id || o.status === 'paid') return false;
    } else if (statusFilter === 'paid_unaudited') {
      if (o.doc_type !== 'RV' || o.audit_id || o.status !== 'paid') return false;
    } else if (statusFilter !== 'all' && o.status !== statusFilter) {
      return false;
    }
    if (shipmentFilter !== 'all' && o.shipment_type !== shipmentFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = `${o.doc_no} ${o.reference_no ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [ops, statusFilter, shipmentFilter, search]);

  // Selected ops, scoped to whatever's currently visible. Excludes
  // fully-paid rows (no remaining to settle); 'partial' rows ARE
  // included since they still have remaining balance.
  const selectedOps = useMemo(
    () => filtered.filter(o => selectedIds.has(o.id) && o.status !== 'paid'),
    [filtered, selectedIds],
  );
  const selectedTotal = useMemo(
    // NET of the selection: debit invoices (remaining, partial-aware)
    // MINUS credit notes (DG/AB/CM). A credit note has owed < 0 and must
    // reduce the total — clamping each row to ≥0 (the old behaviour)
    // silently dropped credits, inflating the "إجمالي" by the credit
    // amount and risking an overpayment.
    () => selectedOps.reduce((s, o) => {
      const owed = (Number(o.amount_dr) || 0) - (Number(o.amount_cr) || 0);
      if (owed < 0) return s + owed;   // credit note → reduces the total
      return s + Math.max(0, owed - (Number(o.amount_paid) || 0));
    }, 0),
    [selectedOps],
  );
  // Every selected op (ANY status) — used for the "تصدير المحدّد" pull.
  // (selectedOps above stays unpaid-only because it drives the bulk-PAY.)
  const selectedAll = useMemo(
    () => filtered.filter(o => selectedIds.has(o.id)),
    [filtered, selectedIds],
  );
  const selectedAllTotal = useMemo(
    () => selectedAll.reduce((s, o) => s + ((Number(o.amount_dr) || 0) - (Number(o.amount_cr) || 0)), 0),
    [selectedAll],
  );

  // Export the selected operations: رقم المستند · التاريخ · المبلغ.
  const exportSelected = useCallback(() => {
    if (!selectedAll.length) return;
    const aoa = [
      ['رقم المستند', 'التاريخ', 'المبلغ (ر.س)'],
      ...selectedAll.map(o => [
        o.doc_no || '',
        o.doc_date || '',
        +(((Number(o.amount_dr) || 0) - (Number(o.amount_cr) || 0))).toFixed(2),
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'عمليات محددة');
    XLSX.writeFile(rtl(wb), `عمليات_${carrier || 'ledger'}_${selectedAll.length}.xlsx`);
    toast(`تم تصدير ${selectedAll.length} عملية`, 'success');
  }, [selectedAll, carrier]);

  // Rows in the current view that *could* be selected — now ALL rows
  // (paid ops are selectable too, so they can be pulled into the export).
  const selectableInView = useMemo(() => filtered, [filtered]);
  const allInViewSelected = selectableInView.length > 0
    && selectableInView.every(o => selectedIds.has(o.id));

  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleSelectAllInView = () => setSelectedIds(prev => {
    if (allInViewSelected) {
      // Clear only the visible ones — keep any selection from other views.
      const next = new Set(prev);
      for (const o of selectableInView) next.delete(o.id);
      return next;
    }
    const next = new Set(prev);
    for (const o of selectableInView) next.add(o.id);
    return next;
  });

  // Period gaps — months between the earliest uploaded statement and now
  // that have NO statement on file for this carrier. A real Aramex flow
  // produces a statement every month, so a missing month is almost always
  // an "I forgot to upload it" situation worth surfacing loudly.
  const periodGaps = useMemo(() => {
    if (!statements.length) return [];
    const months = new Set();
    for (const s of statements) {
      const p = s.period_from || s.period_to;
      if (!p) continue;
      months.add(String(p).slice(0, 7));
    }
    if (!months.size) return [];
    const sorted = [...months].sort();
    const earliest = sorted[0];
    const todayYM = new Date().toISOString().slice(0, 7);
    const gaps = [];
    let cur = earliest;
    while (cur < todayYM) {
      // increment
      const [y, m] = cur.split('-').map(Number);
      cur = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
      if (cur >= todayYM) break;
      if (!months.has(cur)) gaps.push(cur);
    }
    return gaps;
  }, [statements]);

  // Aging buckets — splits unpaid (and unsettled) ops by how long they've
  // been overdue from due_date. Standard AP buckets so the user can rank
  // collection / payment urgency at a glance.
  const aging = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const buckets = {
      notDue:    { count: 0, amount: 0 },
      d30:       { count: 0, amount: 0 },
      d60:       { count: 0, amount: 0 },
      d90:       { count: 0, amount: 0 },
    };
    for (const o of ops) {
      if (o.status === 'paid') continue;
      const amt = (o.amount_dr ?? 0) - (o.amount_cr ?? 0);
      if (amt <= 0) continue;
      // Without a due_date we can't bucket — count as "not due" so the
      // money still appears somewhere.
      if (!o.due_date) {
        buckets.notDue.count++;
        buckets.notDue.amount += amt;
        continue;
      }
      const due = new Date(o.due_date);
      const days = Math.floor((today - due) / 86400000);
      let key;
      if (days <= 0)        key = 'notDue';
      else if (days <= 30)  key = 'd30';
      else if (days <= 60)  key = 'd60';
      else                  key = 'd90';
      buckets[key].count++;
      buckets[key].amount += amt;
    }
    return buckets;
  }, [ops]);

  const counts = useMemo(() => {
    const c = {
      all: ops.length, pending: 0, audited: 0, paid: 0, partial: 0, disputed: 0, reviewing: 0,
      unaudited: 0, paid_unaudited: 0,
    };
    for (const o of ops) {
      c[o.status] = (c[o.status] ?? 0) + 1;
      if (o.doc_type === 'RV' && !o.audit_id) {
        // Open RVs without an audit — leak vector pre-pay.
        if (o.status !== 'paid') c.unaudited++;
        // Paid RVs that were never audited — leak vector post-pay.
        // Easy to forget once paid, so we surface them too.
        else c.paid_unaudited++;
      }
    }
    return c;
  }, [ops]);

  // ── Status mutations ──
  // markPaid handles both full and partial. When `partialAmount` is
  // provided, we create an allocation for that amount (op stays in
  // 'partial' status until allocations sum to the full owed amount).
  // payment_id and status are updated by recalcOperationPaymentState
  // inside createPaymentRecord — no need to setOperationStatus here.
  const markPaid = async (op, payment_ref, partialAmount = null) => {
    try {
      const owed = (Number(op.amount_dr) || 0) - (Number(op.amount_cr) || 0);
      const remaining = +(owed - (Number(op.amount_paid) || 0)).toFixed(2);
      const useAmount = partialAmount != null ? Number(partialAmount) : remaining;
      if (!(useAmount > 0)) {
        toast('المبلغ يجب أن يكون أكبر من صفر', 'error');
        return;
      }
      if (useAmount > remaining + 0.01) {
        toast(`المبلغ يتجاوز المتبقي (${remaining.toFixed(2)} ر.س)`, 'error');
        return;
      }
      await createPaymentRecord({
        carrierId:   carrier,
        paidAt:      new Date().toISOString().slice(0, 10),
        amount:      useAmount,
        paymentRef:  payment_ref || null,
        allocations: [{ opId: op.id, amount: useAmount, partial: useAmount < remaining }],
        userId:      null,
      });
      const isFull = useAmount + 0.01 >= remaining;
      toast(
        isFull
          ? '✓ تم تسديد العملية كاملة'
          : `💰 تسديد جزئي ${useAmount.toFixed(2)} — متبقّي ${(remaining - useAmount).toFixed(2)} ر.س`,
        isFull ? 'success' : 'info',
      );
      refresh();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
    setModal(null);
  };
  const markPaidBulk = async (ops, payment_ref) => {
    const paidAtIso = new Date().toISOString();
    const ref = payment_ref || null;
    // Split the selection: debit invoices get cash allocations (REMAINING,
    // partial-aware); credit notes (DG/AB/CM, owed<0) are APPLIED — they
    // offset the cash, not paid. The recorded cash = debits − credits.
    const allocations = [];
    const creditOpIds = [];
    let creditTotal = 0;
    for (const o of ops) {
      const owed = (Number(o.amount_dr) || 0) - (Number(o.amount_cr) || 0);
      if (owed > 0) {
        const remaining = +(owed - (Number(o.amount_paid) || 0)).toFixed(2);
        if (remaining > 0) allocations.push({ opId: o.id, amount: remaining });
      } else if (owed < 0) {
        creditOpIds.push(o.id);
        creditTotal += Math.abs(owed);
      }
    }
    if (!allocations.length && !creditOpIds.length) {
      toast('لا توجد مبالغ مستحقة على العمليات المحددة', 'error');
      return;
    }
    const debitTotal = allocations.reduce((s, a) => s + a.amount, 0);
    const cash = +Math.max(0, debitTotal - creditTotal).toFixed(2);  // net cash after applying credits
    try {
      let payment = null;
      if (allocations.length) {
        payment = await createPaymentRecord({
          carrierId:   carrier,
          paidAt:      paidAtIso.slice(0, 10),
          amount:      cash,                 // net cash (credits already deducted)
          paymentRef:  ref,
          allocations,                       // debits fully covered → marked paid
          userId:      null,
        });
        if (ref) {
          await Promise.allSettled(
            allocations.map(a => setOperationStatus(a.opId, { payment_ref: ref })),
          );
        }
      }
      // Applied credit notes → mark consumed (paid) so they leave the open
      // balance. They carried no cash; they reduced what we paid.
      if (creditOpIds.length) {
        await Promise.allSettled(creditOpIds.map(id => setOperationStatus(id, {
          status:      'paid',
          paid_at:     paidAtIso,
          payment_ref: ref,
          ...(payment ? { payment_id: payment.id } : {}),
        })));
      }
      toast(
        `✓ تسديد ${allocations.length} فاتورة`
        + (creditOpIds.length ? ` + تطبيق ${creditOpIds.length} إشعار دائن` : '')
        + ` — صافي ${cash.toFixed(2)} ر.س`,
        'success',
      );
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
    setSelectedIds(new Set());
    setModal(null);
    refresh();
  };
  const markDispute = async (op, notes) => {
    try {
      // openDispute = stamp dispute_opened_at + first dispute_notes entry
      // (auto-detects whether to mark as 'opened' vs 'follow_up').
      await openDispute({ operationId: op.id, note: notes, userId: null });
      toast('تم فتح النزاع', 'success');
      refresh();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
    setModal(null);
  };
  const reopen = async (op) => {
    try {
      await setOperationStatus(op.id, { status: 'pending', paid_at: null });
      toast('تم إعادة فتح العملية', 'info');
      refresh();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
  };

  const linkAudit = async (op, audit, opts = {}) => {
    const { override = false } = opts;
    // Re-validate even when override=true so we can refuse Rule 1
    // (already linked elsewhere) — that one is never overridable.
    const verdict = validateAuditLink(op, audit);
    if (!verdict.ok) {
      if (override && verdict.overridable) {
        // Caller already saw the warning + confirmed; proceed.
      } else {
        toast(verdict.reason, 'error');
        return;
      }
    }
    try {
      // Preserve the operation's current status when linking on a paid op
      // — re-stamping as 'audited' would erase the paid record. We only
      // flip to 'audited' when the op is in pre-payment states.
      const PRE_PAY = new Set(['pending', 'reviewing', 'audited', 'disputed']);
      const nextStatus = PRE_PAY.has(op.status) ? 'audited' : op.status;
      await setOperationStatus(op.id, {
        status: nextStatus,
        audit_id: audit.id,
        invoice_file_name: audit.fileName ?? null,
        audit_link_overridden: override === true,
      });
      await logActivity({
        action:     'audit_linked',
        entityType: 'operation',
        entityId:   op.id,
        carrierId:  op.carrier_id,
        payload:    {
          doc_no: op.doc_no,
          audit_id: audit.id,
          file_name: audit.fileName ?? null,
          override: override === true,
        },
      });
      toast(
        override
          ? `⚠️ ربطت بتجاوز — تم تسجيل الربط رغم الفروق`
          : `✓ ربطت المراجعة — العملية الآن معتمدة`,
        override ? 'info' : 'success',
      );
      refresh();
      setModal(null);
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
  };

  const openSourcePdf = async (stmt) => {
    if (!stmt.source_path) {
      toast('الملف الأصلي غير محفوظ — ارفعه مرة أخرى ليُحفَظ', 'info');
      return;
    }
    try {
      const url = await getStatementFileUrl(stmt.source_path, 600);
      if (url) window.open(url, '_blank', 'noopener');
      else     toast('تعذّر فتح الملف', 'error');
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
  };

  const unlinkAudit = async (op) => {
    try {
      // Restore the op to a sensible pre-link state. If it was already
      // paid, keep it paid (the payment isn't being undone) — just
      // strip the audit binding + the override flag.
      const wasPaid = op.status === 'paid';
      await setOperationStatus(op.id, {
        status: wasPaid ? 'paid' : 'pending',
        audit_id: null,
        invoice_file_name: null,
        audit_link_overridden: false,
      });
      await logActivity({
        action:     'audit_unlinked',
        entityType: 'operation',
        entityId:   op.id,
        carrierId:  op.carrier_id,
        payload:    { doc_no: op.doc_no, prior_audit_id: op.audit_id },
      });
      toast('تم إلغاء الربط', 'info');
      refresh();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
  };

  // Compute the current carrier display name BEFORE any early returns so the
  // hook order stays stable between renders (otherwise we crash with
  // "Rendered fewer hooks than expected" on the second render).
  const currentCarrierName = useMemo(() => {
    const found = carrierList.find(c => c.carrierId === carrier);
    return found?.carrierName || carrier;
  }, [carrier, carrierList]);

  if (loading) return (
    <div style={{ display:'flex', justifyContent:'center', padding:60 }}><Spinner size={22}/></div>
  );

  // First-time empty state — no statement has been saved yet anywhere.
  if (!loading && carrierList.length === 0) {
    return (
      <div style={{ padding: '32px 40px 80px', maxWidth: 1100 }}>
        <h2 style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', margin: 0, marginBottom: 18 }}>
          📒 الدفتر
        </h2>
        <Card style={{ textAlign: 'center', padding: 44 }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>📒</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>الدفتر فاضي</div>
          <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.7, marginBottom: 22, maxWidth: 480, margin: '0 auto 22px' }}>
            ارفع كشف حساب من صفحة <strong style={{ color: 'var(--accent)' }}>"رفع كشف"</strong>،
            ثم اضغط <strong style={{ color: 'var(--green)' }}>"💾 حفظ في الدفتر"</strong> ليتعبأ الدفتر هنا.
          </div>
          <Btn variant="primary" onClick={() => { window.location.href = '/aramex-statements'; }}>
            رفع كشف حساب →
          </Btn>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ padding: '32px 40px 80px', maxWidth: 1300 }}>
      <CarrierTabs carrierId={carrier} carrierName={currentCarrierName} active="ledger"/>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <h2 style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', margin: 0 }}>
            📒 الدفتر
          </h2>
          {carrierList.length > 0 && (
            <select
              value={carrier}
              onChange={e => setCarrier(e.target.value)}
              style={{
                padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: 'var(--card)', border: '1px solid var(--accent)', color: 'var(--text)',
                cursor: 'pointer', minWidth: 180,
              }}
            >
              {carrierList.map(c => (
                <option key={c.carrierId} value={c.carrierId}>
                  {c.carrierName || c.carrierId} · {Number(c.outstanding ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })} ر.س
                </option>
              ))}
            </select>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* كشف حساب رسمي (Excel منسّق برصيد جارٍ) — مستند النزاع/المطالبة */}
          {carrier && (
            <Btn size="sm" variant="ghost" icon={<Download size={14}/>} onClick={async () => {
              try {
                const { exportCarrierSOA } = await import('../lib/carrierSoaExport.js');
                const r = await exportCarrierSOA({ carrierId: carrier, carrierName: currentCarrierName });
                toast(`صدر كشف الحساب — ${r.rowCount} حركة · الرصيد ${Number(r.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })} ر.س`, 'success');
              } catch (e) { toast(`فشل التصدير: ${e.message}`, 'error'); }
            }}>
              كشف حساب رسمي
            </Btn>
          )}
          <Btn size="sm" variant="ghost" icon={<RefreshCw size={14}/>} onClick={refresh}>تحديث</Btn>
        </div>
      </div>

      {/* Balance summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px,1fr))', gap: 12, marginBottom: 12 }}>
        <Stat label="الرصيد المستحق الفعلي" value={fmt(bal?.balance)} suffix="ر.س" color="var(--red)" big/>
        <Stat label="مسدّد سابقاً"          value={fmt(bal?.paid)}    suffix="ر.س" color="var(--green)"/>
        <Stat label="معلّقة"                value={bal?.pending ?? 0}  color="var(--gold)"/>
        <Stat label="متنازع"                value={bal?.disputed ?? 0} color="var(--red)"/>
        <Stat label="مراجعة"                value={bal?.reviewing ?? 0}color="var(--gold)"/>
      </div>

      {/* Aging buckets — outstanding balance split by overdue age. Standard
          AP report so the user knows what's about to age into bad-debt-ish
          territory vs what's freshly due. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
        <AgingCard label="غير مستحق"        sub="due_date في المستقبل"     color="var(--green)" {...aging.notDue}/>
        <AgingCard label="متأخر 1–30 يوم"   sub="نطاق طبيعي"               color="var(--gold)"  {...aging.d30}/>
        <AgingCard label="متأخر 31–60 يوم"  sub="ينبغي المتابعة"           color="#f59e0b"      {...aging.d60}/>
        <AgingCard label="متأخر +60 يوم"    sub="مخاطرة عالية"             color="var(--red)"   {...aging.d90}/>
      </div>

      {/* Statements history (collapsible feel) */}
      {statements.length > 0 && (
        <Card style={{ padding: 0, marginBottom: 14, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
            📑 الكشوف المرفوعة ({statements.length})
          </div>
          <div style={{ display: 'flex', overflowX: 'auto', padding: 10, gap: 8 }}>
            {statements.map(s => (
              <button key={s.id} onClick={() => openSourcePdf(s)}
                disabled={!s.source_path}
                title={s.source_path ? 'افتح الملف الأصلي' : 'الملف الأصلي غير متوفر'}
                style={{
                  flexShrink: 0, padding: '8px 12px', borderRadius: 9,
                  background: s.source_path ? 'var(--surface)' : 'var(--card)',
                  border: `1px solid ${s.source_path ? 'var(--accent)40' : 'var(--border)'}`,
                  color: 'var(--text)', cursor: s.source_path ? 'pointer' : 'default',
                  fontSize: 11, textAlign: 'right', minWidth: 200,
                  opacity: s.source_path ? 1 : 0.55,
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <FileText size={12} color={s.source_path ? 'var(--accent)' : 'var(--muted)'}/>
                  <span style={{ fontWeight: 600 }}>{s.period_from || '—'} ← {s.period_to || '—'}</span>
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                  {Number(s.total_balance ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} ر.س
                  {' · '}{s.operations_count} عملية
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Filters */}
      <Card style={{ padding: 12, marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 8 }}>
          <Select label="الحالة" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">الكل ({counts.all})</option>
            <option value="unaudited">⚠️ غير مدققة — مفتوحة ({counts.unaudited ?? 0})</option>
            <option value="paid_unaudited">⚠️ مسدّدة بدون تدقيق ({counts.paid_unaudited ?? 0})</option>
            <option value="pending">⏳ معلّقة ({counts.pending ?? 0})</option>
            <option value="reviewing">🔄 مراجعة ({counts.reviewing ?? 0})</option>
            <option value="audited">🔬 مدققة ({counts.audited ?? 0})</option>
            <option value="disputed">⚠ متنازع ({counts.disputed ?? 0})</option>
            <option value="partial">🟡 مسدّدة جزئياً ({counts.partial ?? 0})</option>
            <option value="paid">✓ مسدّدة ({counts.paid ?? 0})</option>
          </Select>
          <Select label="نوع الشحنة" value={shipmentFilter} onChange={e => setShipmentFilter(e.target.value)}>
            <option value="all">كل الأنواع</option>
            <option value="domestic">محلي</option>
            <option value="domestic_other">محلي (DCF)</option>
            <option value="international_in">دولي وارد</option>
            <option value="international_out">دولي صادر</option>
          </Select>
          <Input label="بحث" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="رقم المستند أو المرجع..."/>
        </div>
      </Card>

      {/* Period gaps — months without a statement, between the earliest one
          we have and last month. Likely "I forgot to upload" cases. */}
      {periodGaps.length > 0 && (
        <div style={{
          marginBottom: 10, padding: '10px 14px',
          background: 'linear-gradient(135deg, rgba(248,113,113,.12), rgba(248,113,113,.04))',
          border: '1px solid var(--red)', borderRadius: 11,
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 18 }}>📭</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--red)' }}>
              فجوة في كشوف الحساب — {periodGaps.length} شهر بدون كشف
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
              الأشهر المفقودة: {periodGaps.slice(0, 6).join(' · ')}
              {periodGaps.length > 6 ? ` · +${periodGaps.length - 6}` : ''}
            </div>
          </div>
          <Btn size="sm" variant="ghost" onClick={() => { window.location.href = '/aramex-statements'; }}>
            رفع كشف →
          </Btn>
        </div>
      )}

      {/* Unaudited-invoices alert — biggest leak vector. One click filters
          the table to just the unverified RV invoices so the user can blast
          through them. Hidden when the filter is already showing them, or
          when there's nothing to chase. */}
      {(counts.unaudited ?? 0) > 0 && statusFilter !== 'unaudited' && (
        <div style={{
          marginBottom: 10, padding: '10px 14px',
          background: 'linear-gradient(135deg, rgba(251,191,36,.16), rgba(251,191,36,.05))',
          border: '1px solid var(--gold)', borderRadius: 11,
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--gold)' }}>
              {counts.unaudited} فاتورة بدون تدقيق
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              فواتير RV لم تُربط بأي مراجعة بعد — مخاطرة فروق غير مكتشفة
            </div>
          </div>
          <Btn size="sm" variant="primary" onClick={() => setStatusFilter('unaudited')}>
            عرضها الآن →
          </Btn>
        </div>
      )}

      {/* Paid-but-unaudited alert — separate so it doesn't dilute the
          higher-priority pre-pay alert above. Easy to skip past once you
          paid the bill, but the audit trail is incomplete without it. */}
      {(counts.paid_unaudited ?? 0) > 0 && statusFilter !== 'paid_unaudited' && (
        <div style={{
          marginBottom: 10, padding: '10px 14px',
          background: 'linear-gradient(135deg, rgba(168,85,247,.12), rgba(168,85,247,.04))',
          border: '1px solid #a855f7', borderRadius: 11,
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 18 }}>💰</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#a855f7' }}>
              {counts.paid_unaudited} فاتورة مسدّدة بدون تدقيق
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              دفعت دون أن تُربط بمراجعة — يمكن الربط الآن بأثر رجعي لإتمام السجلات
            </div>
          </div>
          <Btn size="sm" variant="ghost" onClick={() => setStatusFilter('paid_unaudited')}>
            عرضها الآن →
          </Btn>
        </div>
      )}

      {/* Bulk-action bar — only when something is checked. Sticks to the
          top of the table area so it stays visible while scrolling. */}
      {selectedAll.length > 0 && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 5, marginBottom: 10,
          background: 'linear-gradient(135deg, rgba(45,212,191,.14), rgba(45,212,191,.05))',
          border: '1px solid var(--accent)', borderRadius: 11,
          padding: '10px 14px',
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
          boxShadow: '0 4px 12px rgba(0,0,0,.12)',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{
              fontFamily: 'var(--font-mono)', fontWeight: 700,
              fontSize: 14, color: 'var(--accent)',
            }}>
              {selectedAll.length}
            </span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              عملية محددة · إجمالي
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)', fontWeight: 700,
              fontSize: 16, color: 'var(--text)',
            }}>
              {fmt(selectedAllTotal)} <span style={{ fontSize: 11, color: 'var(--muted)' }}>ر.س</span>
            </span>
          </div>
          <div style={{ flex: 1 }}/>
          <Btn size="sm" variant="primary" onClick={exportSelected}>
            ⬇️ تصدير المحدّد ({selectedAll.length})
          </Btn>
          {selectedOps.length > 0 && (
            <Btn size="sm" variant="success"
              onClick={() => setModal({ ops: selectedOps, action: 'bulk-paid', total: selectedTotal })}>
              💰 تسديد جماعي ({selectedOps.length})
            </Btn>
          )}
          <Btn size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            إلغاء التحديد
          </Btn>
        </div>
      )}

      {/* Doc-type legend — explains the النوع column codes */}
      <DocTypeLegend/>

      {/* Operations table */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ maxHeight: 600, overflowY: 'auto' }}>
          {filtered.length === 0
            ? <Empty icon="📒" title="لا توجد عمليات" sub="ارفع كشف حساب أرامكس لتعبئة الدفتر"/>
            : (
              <table className="m-cards" style={{ fontSize: 12, width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                  <tr>
                    <th style={{ width: 36, textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={allInViewSelected}
                        onChange={toggleSelectAllInView}
                        disabled={selectableInView.length === 0}
                        title={allInViewSelected ? 'إلغاء تحديد الكل في العرض' : 'تحديد الكل في العرض'}
                        style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--accent)' }}
                      />
                    </th>
                    <th style={{ minWidth: 100 }}>الحالة</th>
                    <th style={{ minWidth: 60 }}>النوع</th>
                    <th style={{ minWidth: 110 }}>رقم المستند</th>
                    <th style={{ minWidth: 200 }}>المرجع</th>
                    <th style={{ minWidth: 90 }}>التاريخ</th>
                    <th style={{ minWidth: 90 }}>الاستحقاق</th>
                    <th style={{ minWidth: 110 }}>المبلغ</th>
                    <th style={{ minWidth: 90 }}>نوع الشحنة</th>
                    <th style={{ minWidth: 200 }}>الإجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(o => {
                    const meta = STATUS_META[o.status] ?? STATUS_META.pending;
                    const amount = (o.amount_dr ?? 0) - (o.amount_cr ?? 0);
                    const selectable = o.status !== 'paid';
                    const checked = selectedIds.has(o.id);
                    return (
                      <tr key={o.id} style={checked ? { background: 'rgba(45,212,191,.06)' } : undefined}>
                        <td data-label="" style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSelect(o.id)}
                            title={selectable ? 'اختر للتسديد أو التصدير' : 'اختر للتصدير (مسدّدة)'}
                            style={{
                              width: 16, height: 16,
                              cursor: 'pointer',
                              accentColor: 'var(--accent)',
                              opacity: selectable ? 1 : 0.6,
                            }}
                          />
                        </td>
                        <td data-label="الحالة">
                          <span style={{
                            background: `${meta.color}20`, border: `1px solid ${meta.color}40`,
                            color: meta.color, fontSize: 10, fontWeight: 700,
                            padding: '2px 8px', borderRadius: 12, fontFamily: 'var(--font-mono)',
                            whiteSpace: 'nowrap',
                          }}>{meta.label}</span>
                        </td>
                        <td data-label="النوع">
                          {(() => {
                            const dm = DOC_TYPE_META[o.doc_type];
                            if (!dm) return (
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>
                                {o.doc_type}
                              </span>
                            );
                            return (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                background: `${dm.color}20`, border: `1px solid ${dm.color}40`,
                                color: dm.color, fontSize: 10, fontWeight: 700,
                                padding: '2px 7px', borderRadius: 12,
                                fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
                              }} title={dm.label}>
                                {dm.icon} {o.doc_type}
                              </span>
                            );
                          })()}
                        </td>
                        <td data-label="" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>{o.doc_no}</td>
                        <td data-label="المرجع" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>{o.reference_no}</td>
                        <td data-label="التاريخ" style={{ fontSize: 11, color: 'var(--muted)' }}>{o.doc_date || '—'}</td>
                        <td data-label="الاستحقاق" style={{ fontSize: 11, color: 'var(--muted)' }}>{o.due_date || '—'}</td>
                        <td data-label="المبلغ" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: amount > 0 ? 'var(--red)' : 'var(--green)' }}>
                          {fmt(Math.abs(amount))}
                          {(Number(o.amount_paid) || 0) > 0 && amount > 0 && (() => {
                            const paid = Number(o.amount_paid) || 0;
                            const pct = Math.min(100, Math.round((paid / amount) * 100));
                            return (
                              <div style={{ marginTop: 4 }}>
                                <div style={{
                                  height: 4, background: 'var(--surface)', borderRadius: 2,
                                  overflow: 'hidden',
                                }}>
                                  <div style={{
                                    width: `${pct}%`, height: '100%',
                                    background: pct >= 100 ? 'var(--green)' : '#f59e0b',
                                  }}/>
                                </div>
                                <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                                  مسدّد {paid.toFixed(0)} / {Math.abs(amount).toFixed(0)}
                                </div>
                              </div>
                            );
                          })()}
                        </td>
                        <td data-label="نوع الشحنة" style={{ fontSize: 11 }}>
                          {o.shipment_type ? (() => {
                            const sm = SHIPMENT_META[o.shipment_type];
                            if (!sm) return SHIPMENT_LABEL[o.shipment_type] ?? o.shipment_type;
                            return (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                padding: '2px 8px', borderRadius: 999,
                                background: `${sm.color}1F`,
                                border: `1px solid ${sm.color}55`,
                                color: sm.color, fontSize: 10, fontWeight: 700,
                                fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
                              }}>
                                {sm.icon} {sm.label}
                              </span>
                            );
                          })() : '—'}
                        </td>
                        <td data-label="الإجراء">
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {/* Link / unlink audit — RV invoices only, but paid
                                ops are still linkable (post-pay audit trail). */}
                            {o.doc_type === 'RV' && !o.audit_id && (
                              <Btn size="sm" variant="primary" onClick={() => setModal({ op: o, action: 'link' })}>
                                🔗 ربط مراجعة
                              </Btn>
                            )}
                            {o.audit_id && (
                              <Btn size="sm" variant="ghost" onClick={() => unlinkAudit(o)}>
                                🔗✕ إلغاء الربط
                              </Btn>
                            )}
                            {/* Pay */}
                            {o.status !== 'paid' && (
                              <Btn size="sm" variant="success" onClick={() => setModal({ op: o, action: 'paid' })}>
                                💰 تسديد
                              </Btn>
                            )}
                            {/* Open new dispute */}
                            {o.status !== 'disputed' && o.status !== 'paid' && (
                              <Btn size="sm" variant="ghost" onClick={() => setModal({ op: o, action: 'dispute' })}>
                                ⚠ نزاع
                              </Btn>
                            )}
                            {/* Open dispute thread (drawer) for already-disputed ops */}
                            {o.status === 'disputed' && (
                              <Btn size="sm" variant="ghost" onClick={() => setModal({ op: o, action: 'dispute-thread' })}>
                                💬 سجل النزاع
                              </Btn>
                            )}
                            {/* Reopen — for paid only; disputed gets reopen via thread */}
                            {o.status === 'paid' && (
                              <Btn size="sm" variant="ghost" onClick={() => reopen(o)}>↩ إعادة فتح</Btn>
                            )}
                          </div>
                          {o.audit_id && (
                            <div style={{ marginTop: 4, fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                              🔗 {o.invoice_file_name || o.audit_id.slice(0, 12)}
                              {o.audit_link_overridden && (
                                <span style={{
                                  display: 'inline-block', marginRight: 6,
                                  padding: '1px 7px', borderRadius: 999,
                                  background: 'rgba(251,191,36,.16)',
                                  border: '1px solid var(--gold)',
                                  color: 'var(--gold)', fontSize: 9, fontWeight: 700,
                                }} title="رُبطت رغم وجود تحقق فاشل">
                                  ⚠️ تجاوز
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          }
        </div>
      </Card>

      {/* Action modal */}
      {modal && (
        <ActionModal
          modal={modal}
          carrierName={currentCarrierName}
          onClose={() => setModal(null)}
          onPaid={markPaid}
          onPaidBulk={markPaidBulk}
          onDispute={markDispute}
          onLink={linkAudit}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}

// ── ActionModal ────────────────────────────────────────────────────────────
function ActionModal({ modal, carrierName, onClose, onPaid, onPaidBulk, onDispute, onLink, onRefresh }) {
  const [paymentRef, setPaymentRef] = useState('');
  const [notes, setNotes] = useState('');
  const isPay        = modal.action === 'paid';
  const isLink       = modal.action === 'link';
  const isBulkPay    = modal.action === 'bulk-paid';
  const isThread     = modal.action === 'dispute-thread';

  if (isLink) return <LinkAuditModal op={modal.op} carrierName={carrierName} onClose={onClose} onLink={onLink}/>;
  if (isThread) return <DisputeThreadModal op={modal.op} onClose={onClose} onRefresh={onRefresh}/>;

  // Bulk-paid: shared payment_ref applies to every selected op. We show
  // a brief preview so the user can sanity-check what's about to be
  // marked before committing. Large totals trip a second confirmation
  // gate (HIGH_VALUE_THRESHOLD) so a fat-finger can't accidentally
  // commit a six-figure batch.
  if (isBulkPay) {
    const HIGH_VALUE_THRESHOLD = 50000; // SAR — anything above demands re-confirm
    const ops = modal.ops ?? [];
    const total = modal.total ?? 0;
    const isHighValue = total > HIGH_VALUE_THRESHOLD;
    return (
      <Modal title={`💰 تسديد جماعي · ${ops.length} عملية`} onClose={onClose} width={520}>
        <div style={{
          marginBottom: 14, padding: '10px 14px',
          background: 'rgba(34,197,94,.08)',
          border: '1px solid rgba(34,197,94,.3)',
          borderRadius: 9, fontSize: 13,
        }}>
          الإجمالي:{' '}
          <span style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 16 }}>
            {Number(total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س
          </span>
        </div>
        <div style={{
          maxHeight: 220, overflowY: 'auto', marginBottom: 14,
          border: '1px solid var(--border)', borderRadius: 9,
        }}>
          <table style={{ fontSize: 11, width: '100%' }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
              <tr>
                <th style={{ minWidth: 110 }}>رقم المستند</th>
                <th style={{ minWidth: 90 }}>التاريخ</th>
                <th style={{ minWidth: 100, textAlign: 'left' }}>المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {ops.map(o => {
                const amt = (o.amount_dr ?? 0) - (o.amount_cr ?? 0);
                const isCredit = amt < 0;
                return (
                  <tr key={o.id}>
                    <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                      {o.doc_no}{isCredit && <span style={{ color: 'var(--green)', fontSize: 9, marginRight: 4 }}> ↩ دائن</span>}
                    </td>
                    <td style={{ color: 'var(--muted)' }}>{o.doc_date || '—'}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, textAlign: 'left', color: isCredit ? 'var(--green)' : 'var(--text)' }}>
                      {isCredit ? '−' : ''}{Number(Math.abs(amt)).toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Input label="رقم الحوالة المشترك (اختياري)" value={paymentRef}
          onChange={e => setPaymentRef(e.target.value)} placeholder="FT261XXXX"/>
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>
          نفس الرقم سيُسجَّل على كل العمليات المحددة.
        </div>

        {/* High-value confirmation gate — shows when total exceeds the
            threshold. The user must explicitly tick the checkbox before
            the confirm button enables. */}
        {isHighValue && (
          <div style={{
            marginTop: 12, padding: '10px 14px',
            background: 'rgba(248,113,113,.08)',
            border: '1px solid var(--red)', borderRadius: 9,
          }}>
            <div style={{ fontWeight: 700, color: 'var(--red)', fontSize: 13, marginBottom: 6 }}>
              ⚠️ مبلغ كبير — يحتاج تأكيد إضافي
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.6 }}>
              الإجمالي ({Number(total).toLocaleString('en-US', { minimumFractionDigits: 2 })} ر.س) يتجاوز الحد ({HIGH_VALUE_THRESHOLD.toLocaleString('en-US')} ر.س).
              يرجى التحقق من الرقم قبل التأكيد.
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox"
                checked={notes === '__hv_ok__'}
                onChange={e => setNotes(e.target.checked ? '__hv_ok__' : '')}
                style={{ width: 16, height: 16, accentColor: 'var(--red)', cursor: 'pointer' }}/>
              <span>راجعت المبلغ وأؤكد التسديد</span>
            </label>
          </div>
        )}

        <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 18 }}>
          <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
          <Btn variant="success"
            disabled={isHighValue && notes !== '__hv_ok__'}
            onClick={() => onPaidBulk(ops, paymentRef)}>
            تأكيد تسديد {ops.length} عملية
          </Btn>
        </div>
      </Modal>
    );
  }

  // Pay modal state for partial pay: 'full' covers the remaining
  // owed; 'partial' opens a numeric input. We never disable 'full'
  // since the user might mean to top up an already-partial op.
  const owed = isPay ? (Number(modal.op.amount_dr) || 0) - (Number(modal.op.amount_cr) || 0) : 0;
  const alreadyPaid = isPay ? (Number(modal.op.amount_paid) || 0) : 0;
  const remaining = isPay ? +(owed - alreadyPaid).toFixed(2) : 0;
  // 'partialAmount' lives in `notes` to keep ActionModal's local state
  // surface small. Fresh modals start in 'full' mode so the common
  // case (one click, full pay) stays one-click.
  const isPartialMode = notes.startsWith('__partial:');
  const partialAmount = isPartialMode ? parseFloat(notes.slice(10)) : 0;
  const setPartialAmount = (v) => setNotes(v == null ? '' : `__partial:${v}`);

  return (
    <Modal title={isPay ? '💰 تحديد كمسدّدة' : '⚠ تحديد كمتنازع'} onClose={onClose} width={460}>
      <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--muted)' }}>
        رقم المستند: <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{modal.op.doc_no}</span>
        {' · '}المبلغ الكلي: <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
          {Number(owed).toFixed(2)} ر.س
        </span>
        {isPay && alreadyPaid > 0 && (
          <div style={{ marginTop: 4, fontSize: 12 }}>
            مسدّد سابقاً:{' '}
            <span style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>
              {alreadyPaid.toFixed(2)} ر.س
            </span>
            {' · '}متبقّي:{' '}
            <span style={{ color: 'var(--gold)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
              {remaining.toFixed(2)} ر.س
            </span>
          </div>
        )}
      </div>
      {isPay ? (
        <>
          {/* Mode toggle */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <button onClick={() => setNotes('')}
              style={{
                flex: 1, padding: '8px 10px', borderRadius: 8,
                background: !isPartialMode ? 'var(--green)20' : 'transparent',
                border: `1px solid ${!isPartialMode ? 'var(--green)' : 'var(--border)'}`,
                color: !isPartialMode ? 'var(--green)' : 'var(--muted)',
                fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
              }}>
              ✓ تسديد كامل ({remaining.toFixed(2)} ر.س)
            </button>
            <button onClick={() => setPartialAmount(remaining ? Math.floor(remaining / 2) : '')}
              style={{
                flex: 1, padding: '8px 10px', borderRadius: 8,
                background: isPartialMode ? 'var(--gold)20' : 'transparent',
                border: `1px solid ${isPartialMode ? 'var(--gold)' : 'var(--border)'}`,
                color: isPartialMode ? 'var(--gold)' : 'var(--muted)',
                fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
              }}>
              💰 تسديد جزئي
            </button>
          </div>

          {isPartialMode && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', color: 'var(--muted)', fontSize: 11, marginBottom: 4 }}>
                المبلغ المسدّد (الحد الأقصى {remaining.toFixed(2)} ر.س)
              </label>
              <input type="number" step="0.01" min="0.01" max={remaining}
                value={isPartialMode ? notes.slice(10) : ''}
                onChange={e => setPartialAmount(e.target.value)}
                placeholder="مثلاً 50000"
                style={{ width: '100%', padding: '9px 12px', borderRadius: 7, fontSize: 13, fontFamily: 'var(--font-mono)' }}
              />
              {partialAmount > 0 && partialAmount < remaining && (
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>
                  بعد التسديد سيتبقّى:{' '}
                  <span style={{ color: 'var(--gold)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    {(remaining - partialAmount).toFixed(2)} ر.س
                  </span>
                </div>
              )}
            </div>
          )}

          <Input label="رقم الحوالة (اختياري)" value={paymentRef}
            onChange={e => setPaymentRef(e.target.value)} placeholder="FT261XXXX"/>
        </>
      ) : (
        <Input label="ملاحظات النزاع" value={notes}
          onChange={e => setNotes(e.target.value)} placeholder="السبب أو رقم المرجع..."/>
      )}
      <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 18 }}>
        <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
        <Btn variant={isPay ? 'success' : 'primary'}
          disabled={isPay && isPartialMode && !(partialAmount > 0)}
          onClick={() => isPay
            ? onPaid(modal.op, paymentRef, isPartialMode ? partialAmount : null)
            : onDispute(modal.op, notes)}>
          تأكيد
        </Btn>
      </div>
    </Modal>
  );
}

// Validate that an audit is safe to link to an operation. Returns { ok: true }
// or { ok: false, reason }. Three rules, in order of precedence:
//   1. Already linked elsewhere → reject (one audit = one operation)
//   2. Has open issues → reject
//   3. Total billed (grossed up by VAT) must equal operation amount within tolerance
//
// IMPORTANT — VAT handling
// Carrier statement amounts (carrier_operations) carry the line gross —
// i.e. sub-total + tax — exactly the same number you see on the PDF. The
// audit's totalBilled is the sum of delivery + RSS + fuel from the per-
// shipment Excel, PRE-tax. We need a gross figure to compare.
//
// Strategy, in order of preference:
//   1. audit.totalTax — actual sum of "Tax Amount" verbatim from the
//      file. Works for ZOBI export (tax=0), ZDOI domestic (~15%),
//      ZDCF COD (15% × fee). This is the only path that's exact.
//   2. audit.auditType === 'international' → assume zero-rated → tax=0.
//      Fallback for legacy audits saved before total_tax existed.
//   3. Otherwise → 15% × billed (covers domestic + COD legacy audits).
const LINK_AMOUNT_TOLERANCE = 1.0; // SAR
const VAT_RATE = 0.15;

function validateAuditLink(op, audit, opts = {}) {
  const linkedIndex = opts.linkedIndex; // Map(audit_id → { opId, docNo })
  const opAmount = (Number(op.amount_dr) || 0) - (Number(op.amount_cr) || 0);
  const auditBilledNet = Number(audit.totalBilled ?? opts.totalBilled ?? 0);
  const auditTax       = audit.totalTax  ?? opts.totalTax  ?? null;
  const auditType      = audit.auditType ?? opts.auditType ?? null;
  let auditBilledGross;
  if (auditTax != null && Number.isFinite(Number(auditTax))) {
    auditBilledGross = +(auditBilledNet + Number(auditTax)).toFixed(2);
  } else if (auditType === 'international') {
    auditBilledGross = +auditBilledNet.toFixed(2);
  } else {
    auditBilledGross = +(auditBilledNet * (1 + VAT_RATE)).toFixed(2);
  }
  const issueCount  = Number(audit.issueCount ?? opts.issueCount  ?? 0);

  // Rule 1 — already linked to a DIFFERENT operation?
  // NEVER overridable — a link override here would corrupt the
  // one-audit-one-operation invariant the rest of the system relies on.
  const taken = audit.id ? linkedIndex?.get(audit.id) : null;
  if (taken && taken.opId !== op.id) {
    return {
      ok: false,
      code: 'linked_elsewhere',
      overridable: false,
      reason:
        `هذه المراجعة مرتبطة فعلاً بعملية أخرى (${taken.docNo}). ` +
        `كل مراجعة تُربط بعملية واحدة فقط.`,
    };
  }
  // Rule 2 — clean audit (overridable: user can force-link with a warning)
  if (issueCount > 0) {
    return {
      ok: false,
      code: 'has_issues',
      overridable: true,
      reason: `المراجعة فيها ${issueCount} فرق — لا يمكن ربطها قبل تصفير الفروق.`,
      issueCount,
    };
  }
  // Rule 3 — amount matches the statement (overridable)
  if (Math.abs(auditBilledGross - opAmount) > LINK_AMOUNT_TOLERANCE) {
    const taxShown = auditTax != null
      ? Number(auditTax).toFixed(2)
      : (auditType === 'international' ? '0.00' : (auditBilledNet * VAT_RATE).toFixed(2));
    const diff = Math.abs(auditBilledGross - opAmount);
    return {
      ok: false,
      code: 'amount_mismatch',
      overridable: true,
      reason:
        `المبلغ لا يطابق الكشف.\n` +
        `الكشف: ${opAmount.toFixed(2)} ر.س · ` +
        `المراجعة: ${auditBilledNet.toFixed(2)} + ضريبة ${taxShown} = ${auditBilledGross.toFixed(2)} ر.س ` +
        `(فرق ${diff.toFixed(2)} ر.س)`,
      diffAmount: diff,
    };
  }
  return { ok: true };
}

// ── LinkAuditModal — pick or upload an audit to attach to this operation ──
function LinkAuditModal({ op, carrierName, onClose, onLink }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [audits, setAudits]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  // Map(audit_id → { opId, docNo, carrierId }) — every audit currently linked
  // to ANY operation. Used to enforce one-audit-one-operation in Rule 1.
  const [linkedIndex, setLinkedIndex] = useState(new Map());
  // When the user clicks an audit that fails an overridable rule, we
  // park it here and render a confirmation panel instead of routing
  // straight to onLink. Cleared when they confirm or cancel.
  const [overrideAudit, setOverrideAudit] = useState(null); // { audit, verdict }

  useEffect(() => {
    Promise.all([loadAuditsFromDB(200), loadLinkedAuditIndex().catch(() => new Map())])
      .then(([rows, idx]) => {
        setLinkedIndex(idx);
        // Audits are tagged by carrier name string (e.g., "أرامكس" / "ارامكس" /
        // "سمسا SMSA"). Match loosely on the same word stem so spelling
        // variants line up.
        let pool = rows;
        if (carrierName) {
          const norm = carrierName.toLowerCase();
          const tokens = norm.split(/[\s/]+/).filter(t => t.length >= 3);
          pool = rows.filter(r => {
            const nm = (r.carrierName || '').toLowerCase();
            return tokens.some(t => nm.includes(t));
          });
          // If nothing matched, fall back to the full list (better than empty).
          if (pool.length === 0) pool = rows;
        }
        // Sort: file name containing this doc_no first.
        pool.sort((a, b) => {
          const aHit = (a.fileName || '').includes(op.doc_no) ? 0 : 1;
          const bHit = (b.fileName || '').includes(op.doc_no) ? 0 : 1;
          if (aHit !== bHit) return aHit - bHit;
          return new Date(b.date) - new Date(a.date);
        });
        setAudits(pool);
        setLoading(false);
      })
      .catch(() => { setAudits([]); setLoading(false); });
  }, [op.doc_no, carrierName]);

  const filtered = useMemo(() => {
    if (!audits) return [];
    // Hide audits already linked to ANY operation — the user can't pick
    // them anyway (Rule 1 in validateAuditLink rejects them) and seeing
    // them in the picker is just visual noise.
    const pool = audits.filter(a => !linkedIndex.has(a.id));
    if (!search.trim()) return pool;
    const q = search.trim().toLowerCase();
    return pool.filter(a =>
      `${a.carrierName} ${a.period} ${a.fileName ?? ''}`.toLowerCase().includes(q)
    );
  }, [audits, search, linkedIndex]);

  // ── Inline upload: read Excel → audit → save → link to this operation ──
  const handleInlineUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    setUploadStatus('قراءة الملف...');
    try {
      // 1. Find the carrier from the database (need the contract for pricing)
      const carriers = await loadCarriers();
      const carrier = carriers.find(c =>
        c.id === op.carrier_id
        || (c.name && c.name === carrierName)
        || (c.name && carrierName && c.name.toLowerCase().includes(carrierName.toLowerCase()))
      ) || carriers[0];
      if (!carrier) throw new Error('شركة الشحن غير معرّفة في النظام');

      // 2. Read Excel
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
      if (!allRows.length) throw new Error('الملف فارغ');

      // 3. Detect columns — prefer AI when configured, else regex.
      let headerRow = detectHeaderRow(allRows);
      let headers   = buildHeaders(allRows[headerRow]);
      let colMap    = detectColumns(headers);
      const settings = loadSettings();
      if (settings.openrouterKey) {
        setUploadStatus('✨ AI يعيّن الأعمدة...');
        try {
          const aiResult = await aiAnalyzeFile(allRows);
          if (aiResult) {
            headerRow = Math.min(aiResult.headerRow ?? headerRow, allRows.length - 2);
            headers   = buildHeaders(allRows[headerRow]);
            const merged = { ...detectColumns(headers) };
            for (const [field, col] of Object.entries(aiResult.colMap || {})) {
              if (col && headers.includes(col)) merged[field] = col;
              else if (col === null)             merged[field] = null;
            }
            colMap = merged;
          }
        } catch { /* AI optional — fall through to regex */ }
      }

      // 4. Build rows + audit
      setUploadStatus('جارٍ التدقيق...');
      const data = allRows.slice(headerRow + 1)
        .filter(row => row && row.some(v => v !== null && v !== '' && v !== undefined))
        .map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
      const keepUnbilled = !!carrier?.contracts?.some(c => c.priceFromContract);
      const mapped  = mapRows(data, colMap, { keepUnbilled });
      const forDate = op.doc_date || new Date().toISOString().slice(0, 10);
      const results = auditAll(mapped, carrier, forDate);
      // Cross-audit duplicate check — flags AWBs that have already appeared
      // in any past audit for this carrier (e.g. same shipment billed last
      // month and again this month). Within-file duplicates are caught by
      // auditAll; this catches the cross-month case.
      setUploadStatus('فحص التكرار بين الأشهر...');
      try { await applyCrossAuditDuplicates(results, carrier.id); }
      catch { /* ledger lookup is best-effort — don't block the audit */ }
      const summary = buildSummary(results);

      if (!results.length) throw new Error('لم تُستخرج أي شحنة من الملف — تحقق من الأعمدة');

      // 5. Persist the audit FIRST — even if it can't be linked we want it
      // saved so the user can open it from "📋 السجل", verify the column
      // mapping the system picked, and inspect the rows that caused the
      // mismatch. The link gate runs AFTER save.
      const totalBilled = results.reduce((s, r) => s + (Number(r.invoiced?.total) || 0), 0);
      const totalTax    = results.reduce((s, r) => s + (Number(r.invoiced?.tax)   || 0), 0);
      const auditType   = deriveAuditType(results);
      const auditId = `a_${Date.now()}`;
      const period  = (op.doc_date || forDate).slice(0, 7);
      const audit = {
        id:           auditId,
        carrierId:    carrier.id,
        carrierName:  carrier.name,
        period,
        auditType,
        fileName:     file.name,
        rowCount:     results.length,
        issueCount:   summary.mismatch,
        diff:         summary.totalDiff,
        colMap,
        summary: { ...summary, totalBilled, totalTax },
        results,
        createdAt:    new Date().toISOString(),
      };
      await saveAuditToDB(audit, user?.id);

      // 6. Validate — only NOW decide whether to actually link.
      const verdict = validateAuditLink(op, {}, {
        issueCount: summary.mismatch,
        totalBilled,
        totalTax,
        auditType,
      });
      if (!verdict.ok) {
        // Don't link — but do open the audit so the user can verify columns
        // and see the rows that caused the difference. The audit is already
        // in the DB and shows up in 📋 السجل.
        toast(
          `${verdict.reason}\n` +
          `حُفظت المراجعة — افتح النتائج لتراجع الأعمدة والصفوف.`,
          'error',
        );
        sessionStorage.setItem('lastAudit', JSON.stringify({
          id: auditId,
          carrierId:   carrier.id,
          carrierName: carrier.name,
          period,
          fileName:    file.name,
          rowCount:    results.length,
          issueCount:  summary.mismatch,
          diff:        summary.totalDiff,
          colMap,
          summary:     { ...summary, totalBilled },
          results,
          date:        audit.createdAt,
        }));
        onClose();
        navigate('/results');
        return;
      }

      // 7. Validation passed → link the just-created audit (parent
      // re-validates with linkedIndex too). We pass tax + type so the
      // re-validation uses the exact same gross figure we just computed.
      await onLink(op, {
        id:          auditId,
        fileName:    file.name,
        issueCount:  summary.mismatch,
        totalBilled,
        totalTax,
        auditType,
      });

      toast(`تم التدقيق وربطه (${summary.mismatch} فرق · ${summary.totalDiff.toFixed(2)} ر.س)`, 'success');
    } catch (e) {
      console.error(e);
      toast(`فشل: ${e.message}`, 'error');
    }
    setUploading(false);
    setUploadStatus('');
  };

  return (
    <Modal title="🔗 ربط مراجعة بالعملية" onClose={onClose} width={620}>
      <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--muted)' }}>
        ربط بـ: <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{op.doc_no}</span>
        {' · '}المبلغ: <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
          {Number((op.amount_dr ?? 0) - (op.amount_cr ?? 0)).toFixed(2)} ر.س
        </span>
      </div>

      {/* Inline upload — bypass the wizard for one-off attachments */}
      <button
        onClick={() => document.getElementById('link-audit-file').click()}
        disabled={uploading}
        style={{
          width: '100%', padding: '14px 16px', marginBottom: 12,
          background: 'rgba(45,212,191,.06)',
          border: '1.5px dashed var(--accent)',
          borderRadius: 10, cursor: uploading ? 'wait' : 'pointer',
          color: 'var(--accent)', fontWeight: 600, fontSize: 13,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          fontFamily: 'inherit',
        }}
      >
        {uploading
          ? <><Spinner size={14}/> {uploadStatus || 'جارٍ المعالجة...'}</>
          : <><Upload size={16}/> ارفع فاتورة Excel وربطها مباشرة</>
        }
      </button>
      <input id="link-audit-file" type="file" accept=".xlsx,.xls"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleInlineUpload(f); }}/>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0', color: 'var(--muted)', fontSize: 11 }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }}/>
        <span>أو اختر من المراجعات السابقة</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }}/>
      </div>

      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Search size={14} style={{ position: 'absolute', right: 12, top: 11, color: 'var(--muted)' }}/>
        <input
          autoFocus value={search} onChange={e => setSearch(e.target.value)}
          placeholder="بحث بالفترة أو اسم الملف..."
          style={{ width: '100%', padding: '9px 36px 9px 12px', borderRadius: 9, fontSize: 13 }}
        />
      </div>

      {loading
        ? <div style={{ textAlign: 'center', padding: 30 }}><Spinner size={20}/></div>
        : filtered.length === 0
          ? <Empty icon="🔍" title="لا توجد مراجعات أرامكس" sub="ارفع فاتورة Excel من 'مراجعة جديدة' أولاً"/>
          : (
            <div style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filtered.map(a => {
                const matchHint = (a.fileName || '').includes(op.doc_no);
                const verdict = validateAuditLink(op, a, { linkedIndex });
                const eligible = verdict.ok;
                // Overridable failure: clicking opens a confirmation panel
                // instead of immediately linking. Non-overridable failures
                // (Rule 1) stay fully disabled.
                const overridable = !eligible && verdict.overridable;
                const handleClick = () => {
                  if (eligible) onLink(op, a);
                  else if (overridable) setOverrideAudit({ audit: a, verdict });
                };
                return (
                  <button
                    key={a.id}
                    onClick={handleClick}
                    disabled={!eligible && !overridable}
                    title={eligible ? 'اضغط للربط' : overridable ? 'اضغط لمراجعة التجاوز' : verdict.reason}
                    style={{
                      display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'center',
                      padding: '10px 14px', borderRadius: 9,
                      cursor: (eligible || overridable) ? 'pointer' : 'not-allowed',
                      background: eligible
                        ? (matchHint ? 'rgba(45,212,191,.06)' : 'var(--surface)')
                        : overridable
                          ? 'rgba(251,191,36,.06)'
                          : 'rgba(248,113,113,.04)',
                      border: `1px solid ${eligible
                        ? (matchHint ? 'var(--accent)' : 'var(--border)')
                        : overridable
                          ? 'rgba(251,191,36,.35)'
                          : 'rgba(248,113,113,.25)'}`,
                      textAlign: 'right', color: 'inherit',
                      opacity: (eligible || overridable) ? 1 : 0.7,
                      fontFamily: 'inherit',
                    }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        {a.fileName || '(بدون اسم ملف)'}
                        {matchHint && eligible && <span style={{ marginRight: 8, color: 'var(--accent)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>✦ مطابق</span>}
                      </div>
                      <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>
                        {a.carrierName} · {a.period} · {new Date(a.date).toLocaleDateString('en-GB')}
                      </div>
                      {!eligible && (
                        <div style={{
                          color: overridable ? 'var(--gold)' : 'var(--red)',
                          fontSize: 10.5, marginTop: 4, lineHeight: 1.5,
                        }}>
                          {verdict.reason}
                          {overridable && <div style={{ marginTop: 3, fontWeight: 700 }}>
                            ⚠️ اضغط للربط بتجاوز
                          </div>}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {(() => {
                        // Show the GROSS amount (billed + tax) since that's
                        // what compares against op.amount_dr — avoids the
                        // visual mismatch where a 90,836 pre-VAT figure
                        // sat next to a 104,461 statement amount even
                        // though they actually reconcile via tax.
                        const billed = Number(a.totalBilled ?? 0);
                        const tax    = Number(a.totalTax ?? 0);
                        // Defensive fallback for legacy audits saved
                        // before total_tax existed: international = 0,
                        // others ≈ 15%. Matches validateAuditLink logic.
                        const taxResolved = a.totalTax != null
                          ? tax
                          : (a.auditType === 'international' ? 0 : billed * 0.15);
                        const gross = +(billed + taxResolved).toFixed(2);
                        return <>
                          <div style={{ color: 'var(--muted)', fontSize: 9, marginBottom: 2 }}>الإجمالي شامل الضريبة</div>
                          <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: 13 }}>
                            {gross.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                          <div style={{ color: 'var(--muted)', fontSize: 9, marginTop: 1 }}>
                            {billed.toFixed(0)} + ضريبة {taxResolved.toFixed(0)}
                          </div>
                          <div style={{ color: (a.issueCount ?? 0) > 0 ? 'var(--red)' : 'var(--green)', fontSize: 10, marginTop: 3 }}>
                            {(a.issueCount ?? 0) > 0 ? `✗ ${a.issueCount} فرق` : '✓ نظيف'}
                          </div>
                        </>;
                      })()}
                    </div>
                    <Link2 size={14} color={eligible ? 'var(--accent)' : 'var(--muted3)'}/>
                  </button>
                );
              })}
            </div>
          )
      }

      {overrideAudit && (
        <div style={{
          marginTop: 14, padding: '14px 16px',
          background: 'rgba(251,191,36,.08)',
          border: '1.5px solid var(--gold)',
          borderRadius: 11, fontSize: 13, lineHeight: 1.7,
        }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--gold)', marginBottom: 8 }}>
            ⚠️ تأكيد الربط بتجاوز
          </div>
          <div style={{ color: 'var(--text)', fontSize: 12, marginBottom: 10 }}>
            ستربط هذه المراجعة بالعملية رغم وجود تحقّق فاشل:
          </div>
          <div style={{
            background: 'var(--card)', padding: '10px 12px', borderRadius: 8,
            border: '1px solid var(--border)',
            fontSize: 12, lineHeight: 1.7, color: 'var(--muted)',
            whiteSpace: 'pre-line', marginBottom: 12,
          }}>
            {overrideAudit.verdict.reason}
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 10 }}>
            ستُسجَّل العملية كمعتمدة، مع علامة "تم التجاوز" للمراجعة الداخلية.
            تقدر تلغي الربط لاحقاً من نفس الصف.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn variant="ghost" size="sm" onClick={() => setOverrideAudit(null)}>تراجع</Btn>
            <Btn variant="primary" size="sm"
              onClick={async () => {
                const a = overrideAudit.audit;
                setOverrideAudit(null);
                await onLink(op, a, { override: true });
              }}>
              تأكيد التجاوز والربط
            </Btn>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 14 }}>
        <Btn variant="ghost" onClick={onClose}>إغلاق</Btn>
      </div>
    </Modal>
  );
}

// ── DisputeThreadModal — full lifecycle for an active dispute ──────────
const NOTE_KIND_META = {
  opened:    { icon: '🔴', label: 'فُتح النزاع',     color: 'var(--red)'   },
  follow_up: { icon: '💬', label: 'متابعة',          color: 'var(--gold)'  },
  response:  { icon: '📩', label: 'رد من الناقل',    color: 'var(--accent)'},
  resolved:  { icon: '✓',  label: 'تم الحل',         color: 'var(--green)' },
  reopened:  { icon: '↩', label: 'أُعيد الفتح',     color: 'var(--gold)'  },
};

function DisputeThreadModal({ op, onClose, onRefresh }) {
  const [notes, setNotes] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState('');
  const [newKind, setNewKind] = useState('follow_up');
  const [busy, setBusy] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [credits, setCredits] = useState([]);
  const [selectedCredit, setSelectedCredit] = useState('');
  const [resolveNote, setResolveNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      loadDisputeNotes(op.id),
      loadCreditCandidates(op.carrier_id),
    ]).then(([n, c]) => {
      if (cancelled) return;
      setNotes(n);
      setCredits(c);
    }).catch(e => {
      if (!cancelled) toast(`فشل: ${e.message}`, 'error');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [op.id, op.carrier_id]);

  const refreshThread = async () => {
    const n = await loadDisputeNotes(op.id);
    setNotes(n);
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) {
      toast('اكتب ملاحظة قبل الإضافة', 'error');
      return;
    }
    setBusy(true);
    try {
      await addDisputeNote({
        operationId: op.id,
        note: newNote,
        kind: newKind,
        userId: null,
      });
      setNewNote('');
      setNewKind('follow_up');
      await refreshThread();
      toast('تم حفظ الملاحظة', 'success');
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
    setBusy(false);
  };

  const handleResolve = async (resolution) => {
    setBusy(true);
    try {
      await resolveDispute({
        operationId: op.id,
        resolution,
        creditOpId: resolution === 'credit_received' ? (selectedCredit || null) : null,
        note: resolveNote,
        userId: null,
      });
      toast(
        resolution === 'credit_received'
          ? '✓ النزاع محلول — مرتبط بالمذكرة الدائنة'
          : '✓ النزاع محلول — تم قبول الفاتورة',
        'success',
      );
      onRefresh?.();
      onClose();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
    setBusy(false);
  };

  const handleReopen = async () => {
    setBusy(true);
    try {
      await reopenDispute({ operationId: op.id, note: 'إعادة فتح', userId: null });
      onRefresh?.();
      await refreshThread();
      toast('تم إعادة فتح النزاع', 'info');
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
    setBusy(false);
  };

  const opAmount = (Number(op.amount_dr) || 0) - (Number(op.amount_cr) || 0);
  const today = new Date(); today.setHours(0,0,0,0);
  const daysOpen = op.dispute_opened_at
    ? Math.floor((today - new Date(op.dispute_opened_at)) / 86_400_000)
    : 0;

  return (
    <Modal title={`💬 سجل النزاع — ${op.doc_no}`} onClose={onClose} width={600}>
      {/* Header summary */}
      <div style={{
        marginBottom: 14, padding: '12px 14px',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 9,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>المبلغ المتنازع عليه</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 16, color: 'var(--red)' }}>
              {fmt(opAmount)} ر.س
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>أيام منذ الفتح</div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 16,
              color: daysOpen > 30 ? 'var(--red)' : daysOpen > 14 ? 'var(--gold)' : 'var(--text)',
            }}>
              {daysOpen} يوم{daysOpen > 30 && ' ⚠️'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>تاريخ الفتح</div>
            <div style={{ fontSize: 13 }}>
              {op.dispute_opened_at ? new Date(op.dispute_opened_at).toLocaleDateString('en-GB') : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Timeline */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 30 }}><Spinner size={20}/></div>
      ) : (
        <div style={{ marginBottom: 14, maxHeight: 280, overflowY: 'auto', padding: '4px 4px 4px 0' }}>
          {(!notes || notes.length === 0) ? (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
              لا توجد ملاحظات بعد. أضف أول متابعة أدناه.
            </div>
          ) : notes.map(n => {
            const meta = NOTE_KIND_META[n.kind] ?? NOTE_KIND_META.follow_up;
            return (
              <div key={n.id} style={{
                display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10,
                padding: '10px 12px', marginBottom: 7,
                background: 'var(--card)', border: `1px solid ${meta.color}30`,
                borderRadius: 9,
              }}>
                <div style={{
                  fontSize: 16, alignSelf: 'flex-start',
                  width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: `${meta.color}20`, borderRadius: '50%',
                }}>
                  {meta.icon}
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ color: meta.color, fontWeight: 700, fontSize: 12 }}>
                      {meta.label}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                      {new Date(n.created_at).toLocaleString('en-US')}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.7, marginTop: 4, whiteSpace: 'pre-wrap' }}>
                    {n.note}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add note form */}
      {!resolveOpen && op.status === 'disputed' && (
        <div style={{
          padding: '12px 14px', background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 9, marginBottom: 12,
        }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, fontFamily: 'var(--font-mono)' }}>
            ➕ إضافة ملاحظة جديدة
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {[
              { k: 'follow_up', l: '💬 متابعة' },
              { k: 'response',  l: '📩 رد من الناقل' },
            ].map(t => (
              <button key={t.k} onClick={() => setNewKind(t.k)}
                style={{
                  flex: 1, padding: '6px 10px', borderRadius: 7,
                  background: newKind === t.k ? 'var(--accent)20' : 'transparent',
                  border: `1px solid ${newKind === t.k ? 'var(--accent)' : 'var(--border)'}`,
                  color: newKind === t.k ? 'var(--accent)' : 'var(--muted)',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                {t.l}
              </button>
            ))}
          </div>
          <textarea
            value={newNote} onChange={e => setNewNote(e.target.value)}
            placeholder="مثلاً: تواصلت مع مدير حساب أرامكس، وعد بالرد خلال 3 أيام..."
            rows={3}
            style={{
              width: '100%', padding: '8px 11px', borderRadius: 7,
              fontSize: 13, fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.7,
            }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <Btn size="sm" variant="primary" onClick={handleAddNote} disabled={busy || !newNote.trim()}>
              {busy ? <Spinner size={12}/> : 'إضافة'}
            </Btn>
          </div>
        </div>
      )}

      {/* Resolve panel */}
      {resolveOpen && op.status === 'disputed' && (
        <div style={{
          padding: '12px 14px',
          background: 'rgba(34,197,94,.08)', border: '1px solid var(--green)',
          borderRadius: 9, marginBottom: 12,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)', marginBottom: 10 }}>
            ✓ إغلاق النزاع
          </div>

          {credits.length > 0 && (
            <>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                مذكرة دائنة من الناقل (اختياري)
              </label>
              <select value={selectedCredit} onChange={e => setSelectedCredit(e.target.value)}
                style={{
                  width: '100%', padding: '7px 10px', borderRadius: 7,
                  fontSize: 12, fontFamily: 'var(--font-mono)', marginBottom: 10,
                }}>
                <option value="">— لا أربط بمذكرة (قبول الفاتورة) —</option>
                {credits.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.doc_type} {c.doc_no} · {c.doc_date} · {fmt(c.amount_cr)} ر.س
                  </option>
                ))}
              </select>
            </>
          )}

          <textarea
            value={resolveNote} onChange={e => setResolveNote(e.target.value)}
            placeholder="ملاحظة الإغلاق (اختياري)..."
            rows={2}
            style={{
              width: '100%', padding: '8px 11px', borderRadius: 7,
              fontSize: 13, fontFamily: 'inherit', resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
            <Btn size="sm" variant="ghost" onClick={() => setResolveOpen(false)}>تراجع</Btn>
            <Btn size="sm" variant="success"
              onClick={() => handleResolve(selectedCredit ? 'credit_received' : 'accepted')}
              disabled={busy}>
              {busy ? <Spinner size={12}/> :
                selectedCredit ? 'إغلاق + ربط بالمذكرة' : 'إغلاق (قبول)'}
            </Btn>
          </div>
        </div>
      )}

      {/* Footer actions */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          {op.status === 'disputed' && !resolveOpen && (
            <Btn size="sm" variant="success" onClick={() => setResolveOpen(true)}>
              ✓ إغلاق النزاع
            </Btn>
          )}
          {op.status !== 'disputed' && (
            <Btn size="sm" variant="ghost" onClick={handleReopen} disabled={busy}>
              ↩ إعادة فتح النزاع
            </Btn>
          )}
        </div>
        <Btn variant="ghost" onClick={onClose}>إغلاق</Btn>
      </div>
    </Modal>
  );
}

// ── Aging bucket card ─────────────────────────────────────────────────────
function AgingCard({ label, sub, count, amount, color }) {
  const dim = !count;
  return (
    <div style={{
      background: dim ? 'var(--card)' : `linear-gradient(135deg, ${color}14, transparent)`,
      border: `1px solid ${dim ? 'var(--border)' : color + '55'}`,
      borderRadius: 11, padding: '11px 14px',
      opacity: dim ? 0.55 : 1,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>{label}</span>
        <span style={{ color, fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{count}</span>
      </div>
      <div style={{ color, fontSize: 16, fontFamily: 'var(--font-mono)', fontWeight: 700, marginTop: 3, whiteSpace: 'nowrap' }}>
        {Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        <span style={{ fontSize: 9, color: 'var(--muted)', marginRight: 4 }}> ر.س</span>
      </div>
      <div style={{ color: 'var(--muted)', fontSize: 9, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

// ── Stat block ────────────────────────────────────────────────────────────
function Stat({ label, value, suffix, color, big }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 11, padding: '13px 16px',
    }}>
      <div style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'var(--font-mono)', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{
        color, fontSize: big ? 22 : 16,
        fontFamily: 'var(--font-mono)', fontWeight: 700, whiteSpace: 'nowrap',
      }}>
        {value}
        {suffix && <span style={{ fontSize: 10, color: 'var(--muted)', marginRight: 4 }}> {suffix}</span>}
      </div>
    </div>
  );
}
