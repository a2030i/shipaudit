import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Search, RefreshCw, Link2, FileText, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Card, Btn, Input, Select, Modal, Empty, Spinner, toast } from '../components/UI.jsx';
import {
  loadOperations,
  loadOpenBalance,
  loadCarriersOverview,
  setOperationStatus,
  loadStatements,
  getStatementFileUrl,
  loadLinkedAuditIndex,
} from '../lib/carrierStatementsService.js';
import { loadCarriers, loadAuditsFromDB, saveAuditToDB } from '../lib/coreService.js';
import {
  detectHeaderRow, buildHeaders, detectColumns, mapRows, auditAll, buildSummary,
} from '../engine/audit.js';
import { aiAnalyzeFile } from '../engine/openrouter.js';
import { loadSettings } from '../data/carriers.js';
import { useAuth } from '../lib/auth.jsx';

// ─── Status meta ───────────────────────────────────────────────────────────
const STATUS_META = {
  pending:   { label: '⏳ معلّقة',   color: 'var(--gold)'   },
  audited:   { label: '✓ معتمدة',   color: 'var(--accent)' },
  paid:      { label: '💰 مسدّدة',   color: 'var(--green)'  },
  disputed:  { label: '⚠ متنازع',   color: 'var(--red)'    },
  reviewing: { label: '🔄 مراجعة',   color: 'var(--gold)'   },
};
const SHIPMENT_LABEL = {
  domestic:           'محلي',
  domestic_other:     'محلي (DCF)',
  international_in:   'دولي وارد',
  international_out:  'دولي صادر',
};
const fmt = n => (n == null || Number.isNaN(n))
  ? '—'
  : Number(n).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  const [modal, setModal] = useState(null); // { op, action: 'paid'|'dispute' }

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

  const filtered = useMemo(() => ops.filter(o => {
    if (statusFilter   !== 'all' && o.status        !== statusFilter)   return false;
    if (shipmentFilter !== 'all' && o.shipment_type !== shipmentFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = `${o.doc_no} ${o.reference_no ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [ops, statusFilter, shipmentFilter, search]);

  const counts = useMemo(() => {
    const c = { all: ops.length, pending: 0, audited: 0, paid: 0, disputed: 0, reviewing: 0 };
    for (const o of ops) c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, [ops]);

  // ── Status mutations ──
  const markPaid = async (op, payment_ref) => {
    try {
      await setOperationStatus(op.id, {
        status: 'paid',
        paid_at: new Date().toISOString(),
        payment_ref: payment_ref || null,
      });
      toast('تم تحديد العملية كمسدّدة', 'success');
      refresh();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
    setModal(null);
  };
  const markDispute = async (op, notes) => {
    try {
      await setOperationStatus(op.id, { status: 'disputed', notes: notes || null });
      toast('تم تحديد العملية كمتنازع', 'success');
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

  const linkAudit = async (op, audit) => {
    // The audit object MUST carry { issueCount, totalBilled } so we can
    // validate the link. The picker passes both straight from
    // loadAuditsFromDB; the inline-upload path computes them from the
    // freshly-built summary before calling onLink.
    const verdict = validateAuditLink(op, audit);
    if (!verdict.ok) {
      toast(verdict.reason, 'error');
      return; // keep modal open so the user can pick another file/audit
    }
    try {
      await setOperationStatus(op.id, {
        status: 'audited',
        audit_id: audit.id,
        invoice_file_name: audit.fileName ?? null,
      });
      toast(`✓ ربطت المراجعة — العملية الآن معتمدة`, 'success');
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
      await setOperationStatus(op.id, {
        status: 'pending',
        audit_id: null,
        invoice_file_name: null,
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
      <div style={{ padding: '28px 32px', maxWidth: 900 }}>
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
    <div style={{ padding: '28px 32px', maxWidth: 1300 }}>
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
                  {c.carrierName || c.carrierId} · {Number(c.outstanding ?? 0).toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر.س
                </option>
              ))}
            </select>
          )}
        </div>
        <Btn size="sm" variant="ghost" icon={<RefreshCw size={14}/>} onClick={refresh}>تحديث</Btn>
      </div>

      {/* Balance summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px,1fr))', gap: 12, marginBottom: 16 }}>
        <Stat label="الرصيد المستحق الفعلي" value={fmt(bal?.balance)} suffix="ر.س" color="var(--red)" big/>
        <Stat label="مسدّد سابقاً"          value={fmt(bal?.paid)}    suffix="ر.س" color="var(--green)"/>
        <Stat label="معلّقة"                value={bal?.pending ?? 0}  color="var(--gold)"/>
        <Stat label="متنازع"                value={bal?.disputed ?? 0} color="var(--red)"/>
        <Stat label="مراجعة"                value={bal?.reviewing ?? 0}color="var(--gold)"/>
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
                  {Number(s.total_balance ?? 0).toLocaleString('ar-SA', { maximumFractionDigits: 2 })} ر.س
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
            <option value="pending">⏳ معلّقة ({counts.pending ?? 0})</option>
            <option value="reviewing">🔄 مراجعة ({counts.reviewing ?? 0})</option>
            <option value="audited">🔬 مدققة ({counts.audited ?? 0})</option>
            <option value="disputed">⚠ متنازع ({counts.disputed ?? 0})</option>
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

      {/* Operations table */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ maxHeight: 600, overflowY: 'auto' }}>
          {filtered.length === 0
            ? <Empty icon="📒" title="لا توجد عمليات" sub="ارفع كشف حساب أرامكس لتعبئة الدفتر"/>
            : (
              <table style={{ fontSize: 12, width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                  <tr>
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
                    return (
                      <tr key={o.id}>
                        <td>
                          <span style={{
                            background: `${meta.color}20`, border: `1px solid ${meta.color}40`,
                            color: meta.color, fontSize: 10, fontWeight: 700,
                            padding: '2px 8px', borderRadius: 12, fontFamily: 'var(--font-mono)',
                            whiteSpace: 'nowrap',
                          }}>{meta.label}</span>
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>{o.doc_type}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>{o.doc_no}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>{o.reference_no}</td>
                        <td style={{ fontSize: 11, color: 'var(--muted)' }}>{o.doc_date || '—'}</td>
                        <td style={{ fontSize: 11, color: 'var(--muted)' }}>{o.due_date || '—'}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: amount > 0 ? 'var(--red)' : 'var(--green)' }}>
                          {fmt(Math.abs(amount))}
                        </td>
                        <td style={{ fontSize: 11 }}>
                          {o.shipment_type ? SHIPMENT_LABEL[o.shipment_type] : '—'}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {/* Link / unlink audit (only for RV invoices) */}
                            {o.doc_type === 'RV' && !o.audit_id && o.status !== 'paid' && (
                              <Btn size="sm" variant="primary" onClick={() => setModal({ op: o, action: 'link' })}>
                                🔗 ربط مراجعة
                              </Btn>
                            )}
                            {o.audit_id && o.status !== 'paid' && (
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
                            {/* Dispute */}
                            {o.status !== 'disputed' && o.status !== 'paid' && (
                              <Btn size="sm" variant="ghost" onClick={() => setModal({ op: o, action: 'dispute' })}>
                                ⚠ نزاع
                              </Btn>
                            )}
                            {/* Reopen */}
                            {(o.status === 'paid' || o.status === 'disputed') && (
                              <Btn size="sm" variant="ghost" onClick={() => reopen(o)}>↩ إعادة فتح</Btn>
                            )}
                          </div>
                          {o.audit_id && (
                            <div style={{ marginTop: 4, fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                              🔗 {o.invoice_file_name || o.audit_id.slice(0, 12)}
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
          onDispute={markDispute}
          onLink={linkAudit}
        />
      )}
    </div>
  );
}

// ── ActionModal ────────────────────────────────────────────────────────────
function ActionModal({ modal, carrierName, onClose, onPaid, onDispute, onLink }) {
  const [paymentRef, setPaymentRef] = useState('');
  const [notes, setNotes] = useState('');
  const isPay  = modal.action === 'paid';
  const isLink = modal.action === 'link';

  if (isLink) return <LinkAuditModal op={modal.op} carrierName={carrierName} onClose={onClose} onLink={onLink}/>;

  return (
    <Modal title={isPay ? '💰 تحديد كمسدّدة' : '⚠ تحديد كمتنازع'} onClose={onClose} width={420}>
      <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--muted)' }}>
        رقم المستند: <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{modal.op.doc_no}</span>
        {' · '}المبلغ: <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
          {Number(modal.op.amount_dr - modal.op.amount_cr).toFixed(2)} ر.س
        </span>
      </div>
      {isPay
        ? <Input label="رقم الحوالة (اختياري)" value={paymentRef}
            onChange={e => setPaymentRef(e.target.value)} placeholder="FT261XXXX"/>
        : <Input label="ملاحظات النزاع" value={notes}
            onChange={e => setNotes(e.target.value)} placeholder="السبب أو رقم المرجع..."/>
      }
      <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 18 }}>
        <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
        <Btn variant={isPay ? 'success' : 'primary'}
          onClick={() => isPay ? onPaid(modal.op, paymentRef) : onDispute(modal.op, notes)}>
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
//   3. Total billed must equal operation amount within tolerance
const LINK_AMOUNT_TOLERANCE = 1.0; // SAR

function validateAuditLink(op, audit, opts = {}) {
  const linkedIndex = opts.linkedIndex; // Map(audit_id → { opId, docNo })
  const opAmount = (Number(op.amount_dr) || 0) - (Number(op.amount_cr) || 0);
  const auditBilled = Number(audit.totalBilled ?? opts.totalBilled ?? 0);
  const issueCount  = Number(audit.issueCount ?? opts.issueCount  ?? 0);

  // Rule 1 — already linked to a DIFFERENT operation?
  const taken = audit.id ? linkedIndex?.get(audit.id) : null;
  if (taken && taken.opId !== op.id) {
    return {
      ok: false,
      reason:
        `هذه المراجعة مرتبطة فعلاً بعملية أخرى (${taken.docNo}). ` +
        `كل مراجعة تُربط بعملية واحدة فقط.`,
    };
  }
  // Rule 2 — clean audit
  if (issueCount > 0) {
    return {
      ok: false,
      reason: `المراجعة فيها ${issueCount} فرق — لا يمكن ربطها قبل تصفير الفروق.`,
    };
  }
  // Rule 3 — amount matches the statement
  if (Math.abs(auditBilled - opAmount) > LINK_AMOUNT_TOLERANCE) {
    return {
      ok: false,
      reason:
        `المبلغ لا يطابق الكشف.\n` +
        `الكشف: ${opAmount.toFixed(2)} ر.س · المراجعة: ${auditBilled.toFixed(2)} ر.س ` +
        `(فرق ${Math.abs(auditBilled - opAmount).toFixed(2)} ر.س)`,
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
    if (!search.trim()) return audits;
    const q = search.trim().toLowerCase();
    return audits.filter(a =>
      `${a.carrierName} ${a.period} ${a.fileName ?? ''}`.toLowerCase().includes(q)
    );
  }, [audits, search]);

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
      const mapped  = mapRows(data, colMap);
      const forDate = op.doc_date || new Date().toISOString().slice(0, 10);
      const results = auditAll(mapped, carrier, forDate);
      const summary = buildSummary(results);

      if (!results.length) throw new Error('لم تُستخرج أي شحنة من الملف — تحقق من الأعمدة');

      // 5. Persist the audit FIRST — even if it can't be linked we want it
      // saved so the user can open it from "📋 السجل", verify the column
      // mapping the system picked, and inspect the rows that caused the
      // mismatch. The link gate runs AFTER save.
      const totalBilled = results.reduce((s, r) => s + (Number(r.invoiced?.total) || 0), 0);
      const auditId = `a_${Date.now()}`;
      const period  = (op.doc_date || forDate).slice(0, 7);
      const audit = {
        id:           auditId,
        carrierId:    carrier.id,
        carrierName:  carrier.name,
        period,
        fileName:     file.name,
        rowCount:     results.length,
        issueCount:   summary.mismatch,
        diff:         summary.totalDiff,
        colMap,
        summary: { ...summary, totalBilled },
        results,
        createdAt:    new Date().toISOString(),
      };
      await saveAuditToDB(audit, user?.id);

      // 6. Validate — only NOW decide whether to actually link.
      const verdict = validateAuditLink(op, {}, {
        issueCount: summary.mismatch,
        totalBilled,
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
      // re-validates with linkedIndex too).
      await onLink(op, {
        id:          auditId,
        fileName:    file.name,
        issueCount:  summary.mismatch,
        totalBilled,
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
          background: 'rgba(56,189,248,.06)',
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
                return (
                  <button
                    key={a.id}
                    onClick={() => eligible && onLink(op, a)}
                    disabled={!eligible}
                    title={eligible ? 'اضغط للربط' : verdict.reason}
                    style={{
                      display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'center',
                      padding: '10px 14px', borderRadius: 9,
                      cursor: eligible ? 'pointer' : 'not-allowed',
                      background: eligible
                        ? (matchHint ? 'rgba(56,189,248,.06)' : 'var(--surface)')
                        : 'rgba(248,113,113,.04)',
                      border: `1px solid ${eligible
                        ? (matchHint ? 'var(--accent)' : 'var(--border)')
                        : 'rgba(248,113,113,.25)'}`,
                      textAlign: 'right', color: 'inherit', opacity: eligible ? 1 : 0.7,
                      fontFamily: 'inherit',
                    }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        {a.fileName || '(بدون اسم ملف)'}
                        {matchHint && eligible && <span style={{ marginRight: 8, color: 'var(--accent)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>✦ مطابق</span>}
                      </div>
                      <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>
                        {a.carrierName} · {a.period} · {new Date(a.date).toLocaleDateString('ar-SA')}
                      </div>
                      {!eligible && (
                        <div style={{ color: 'var(--red)', fontSize: 10.5, marginTop: 4, lineHeight: 1.5 }}>
                          {verdict.reason}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      <div style={{ color: 'var(--muted)', fontSize: 9, marginBottom: 2 }}>المفوتر</div>
                      <div style={{ color: 'var(--text)', fontWeight: 700 }}>
                        {Number(a.totalBilled ?? 0).toFixed(0)}
                      </div>
                      <div style={{ color: (a.issueCount ?? 0) > 0 ? 'var(--red)' : 'var(--green)', fontSize: 10, marginTop: 2 }}>
                        {(a.issueCount ?? 0) > 0 ? `✗ ${a.issueCount} فرق` : '✓ نظيف'}
                      </div>
                    </div>
                    <Link2 size={14} color={eligible ? 'var(--accent)' : 'var(--muted3)'}/>
                  </button>
                );
              })}
            </div>
          )
      }

      <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 14 }}>
        <Btn variant="ghost" onClick={onClose}>إغلاق</Btn>
      </div>
    </Modal>
  );
}

// ── Stat block ────────────────────────────────────────────────────────────
function Stat({ label, value, suffix, color, big }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 11, padding: '13px 16px',
      borderTop: `3px solid ${color}`,
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
