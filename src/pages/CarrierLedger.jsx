import { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, RefreshCw, CheckCircle2, AlertOctagon, Clock, Eye } from 'lucide-react';
import { Card, Btn, Input, Select, Modal, Empty, Spinner, Badge, toast } from '../components/UI.jsx';
import {
  loadOperations,
  loadOpenBalance,
  setOperationStatus,
} from '../lib/carrierStatementsService.js';

// ─── Status meta ───────────────────────────────────────────────────────────
const STATUS_META = {
  pending:   { label: '⏳ معلّقة',   color: 'var(--gold)'   },
  audited:   { label: '🔬 مدققة',    color: 'var(--accent)' },
  paid:      { label: '✓ مسدّدة',    color: 'var(--green)'  },
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
  const [carrier]   = useState('aramex');
  const [ops, setOps] = useState([]);
  const [bal, setBal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [shipmentFilter, setShipmentFilter] = useState('all');
  const [modal, setModal] = useState(null); // { op, action: 'paid'|'dispute' }

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [opsData, balData] = await Promise.all([
        loadOperations({ carrierId: carrier }),
        loadOpenBalance(carrier),
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

  if (loading) return (
    <div style={{ display:'flex', justifyContent:'center', padding:60 }}><Spinner size={22}/></div>
  );

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1300 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', margin: 0 }}>
          📒 دفتر <span style={{ color: 'var(--text)' }}>أرامكس</span>
        </h2>
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
                            {o.status !== 'paid' && (
                              <Btn size="sm" variant="success" onClick={() => setModal({ op: o, action: 'paid' })}>
                                ✓ تسديد
                              </Btn>
                            )}
                            {o.status !== 'disputed' && o.status !== 'paid' && (
                              <Btn size="sm" variant="ghost" onClick={() => setModal({ op: o, action: 'dispute' })}>
                                ⚠ نزاع
                              </Btn>
                            )}
                            {(o.status === 'paid' || o.status === 'disputed') && (
                              <Btn size="sm" variant="ghost" onClick={() => reopen(o)}>↩ إعادة فتح</Btn>
                            )}
                          </div>
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
      {modal && <ActionModal modal={modal} onClose={() => setModal(null)} onPaid={markPaid} onDispute={markDispute}/>}
    </div>
  );
}

// ── ActionModal ────────────────────────────────────────────────────────────
function ActionModal({ modal, onClose, onPaid, onDispute }) {
  const [paymentRef, setPaymentRef] = useState('');
  const [notes, setNotes] = useState('');
  const isPay = modal.action === 'paid';

  return (
    <Modal title={isPay ? '✓ تحديد كمسدّدة' : '⚠ تحديد كمتنازع'} onClose={onClose} width={420}>
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
