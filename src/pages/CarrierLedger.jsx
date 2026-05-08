import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, RefreshCw, Link2 } from 'lucide-react';
import { Card, Btn, Input, Select, Modal, Empty, Spinner, toast } from '../components/UI.jsx';
import {
  loadOperations,
  loadOpenBalance,
  loadCarriersOverview,
  setOperationStatus,
} from '../lib/carrierStatementsService.js';
import { loadAuditsFromDB } from '../lib/coreService.js';

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
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [shipmentFilter, setShipmentFilter] = useState('all');
  const [modal, setModal] = useState(null); // { op, action: 'paid'|'dispute' }

  // Sync carrier param ↔ URL
  useEffect(() => {
    if (carrier) setSearchParams({ carrier }, { replace: true });
    else         setSearchParams({}, { replace: true });
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

      const [opsData, balData] = await Promise.all([
        loadOperations({ carrierId: effective }),
        loadOpenBalance(effective),
      ]);
      setOps(opsData);
      setBal(balData);
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
    try {
      await setOperationStatus(op.id, {
        status: 'audited',
        audit_id: audit.id,
        invoice_file_name: audit.fileName ?? null,
      });
      toast(`✓ ربطت المراجعة — العملية الآن معتمدة`, 'success');
      refresh();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
    setModal(null);
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

  if (loading) return (
    <div style={{ display:'flex', justifyContent:'center', padding:60 }}><Spinner size={22}/></div>
  );

  const currentCarrierName = useMemo(() => {
    const found = carrierList.find(c => c.carrierId === carrier);
    return found?.carrierName || carrier;
  }, [carrier, carrierList]);

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

// ── LinkAuditModal — pick an existing audit to attach to this operation ──
function LinkAuditModal({ op, carrierName, onClose, onLink }) {
  const [audits, setAudits]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');

  useEffect(() => {
    loadAuditsFromDB(200).then(rows => {
      // Audits are tagged by carrier name string (e.g., "أرامكس" / "ارامكس" /
      // "سمسا SMSA"). Match loosely on the same word stem so spelling variants
      // line up.
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
    }).catch(() => { setAudits([]); setLoading(false); });
  }, [op.doc_no, carrierName]);

  const filtered = useMemo(() => {
    if (!audits) return [];
    if (!search.trim()) return audits;
    const q = search.trim().toLowerCase();
    return audits.filter(a =>
      `${a.carrierName} ${a.period} ${a.fileName ?? ''}`.toLowerCase().includes(q)
    );
  }, [audits, search]);

  return (
    <Modal title="🔗 ربط مراجعة بالعملية" onClose={onClose} width={620}>
      <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--muted)' }}>
        ربط بـ: <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{op.doc_no}</span>
        {' · '}المبلغ: <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
          {Number((op.amount_dr ?? 0) - (op.amount_cr ?? 0)).toFixed(2)} ر.س
        </span>
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
                return (
                  <button key={a.id} onClick={() => onLink(op, a)} style={{
                    display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'center',
                    padding: '10px 14px', borderRadius: 9, cursor: 'pointer',
                    background: matchHint ? 'rgba(56,189,248,.06)' : 'var(--surface)',
                    border: `1px solid ${matchHint ? 'var(--accent)' : 'var(--border)'}`,
                    textAlign: 'right', color: 'inherit',
                  }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        {a.fileName || '(بدون اسم ملف)'}
                        {matchHint && <span style={{ marginRight: 8, color: 'var(--accent)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>✦ مطابق</span>}
                      </div>
                      <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>
                        {a.carrierName} · {a.period} · {new Date(a.date).toLocaleDateString('ar-SA')}
                      </div>
                    </div>
                    <div style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      <div style={{ color: 'var(--muted)', fontSize: 9, marginBottom: 2 }}>الفروق</div>
                      <div style={{ color: (a.issueCount ?? 0) > 0 ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}>
                        {(a.issueCount ?? 0) > 0 ? `✗ ${a.issueCount}` : '✓'}
                      </div>
                    </div>
                    <Link2 size={14} color="var(--accent)"/>
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
