import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw, Search, Trash2, ChevronDown, ChevronLeft, FileText } from 'lucide-react';
import { Card, Btn, Input, Modal, Empty, Spinner, toast } from '../components/UI.jsx';
import {
  loadPayments,
  loadPaymentOps,
  deletePaymentRecord,
  loadCarriersOverview,
} from '../lib/carrierStatementsService.js';

const fmt = n => (n == null || Number.isNaN(n))
  ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SHIPMENT_LABEL = {
  domestic:           '🇸🇦 محلي',
  domestic_other:     '💰 COD محلي',
  international_in:   '✈️ دولي وارد',
  international_out:  '✈️ دولي صادر',
};

export default function Payments({ isActive = true }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [carrier, setCarrier] = useState(() => searchParams.get('carrier') || '');
  const [carrierList, setCarrierList] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null); // payment id whose ops are visible
  const [opsOf, setOpsOf] = useState({}); // { paymentId → ops[] }
  const [confirmDelete, setConfirmDelete] = useState(null);

  // مزامنة الناقل مع الرابط — تُدمَج فقط مفتاح `carrier` وتُبقي بقية المعاملات
  // كما هي (خاصة `tab=` الذي يملكه MoneyHub). كانت `setSearchParams({})` تمسح
  // الرابط كاملاً، وبما أن Payments يبقى mounted داخل الهَب (مخفياً) فكانت تمحو
  // `?tab=bank` عند التحديث فترجع الصفحة للتبويب الافتراضي. + تُشغَّل فقط حين
  // يكون تبويب الدفعات نشطاً فلا تكتب `carrier` على رابط تبويب آخر.
  useEffect(() => {
    if (!isActive) return;
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (carrier) next.set('carrier', carrier);
      else next.delete('carrier');
      return next;
    }, { replace: true });
  }, [carrier, isActive]); // eslint-disable-line

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const overview = await loadCarriersOverview();
      setCarrierList(overview);
      const effective = carrier || overview[0]?.carrierId || '';
      if (!carrier && effective) setCarrier(effective);
      if (effective) {
        const data = await loadPayments({ carrierId: effective });
        setPayments(data);
      } else {
        setPayments([]);
      }
    } catch (e) {
      toast(`خطأ في التحميل: ${e.message}`, 'error');
    }
    setLoading(false);
  }, [carrier]);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh]);
  useEffect(() => { setExpanded(null); setOpsOf({}); }, [carrier]);

  const toggleExpand = async (paymentId) => {
    if (expanded === paymentId) {
      setExpanded(null);
      return;
    }
    setExpanded(paymentId);
    if (!opsOf[paymentId]) {
      try {
        const ops = await loadPaymentOps(paymentId);
        setOpsOf(prev => ({ ...prev, [paymentId]: ops }));
      } catch (e) {
        toast(`فشل تحميل العمليات: ${e.message}`, 'error');
      }
    }
  };

  const handleDelete = async (paymentId) => {
    try {
      await deletePaymentRecord(paymentId);
      toast('تم إلغاء الدفعة وإعادة العمليات إلى "معلّقة"', 'info');
      setConfirmDelete(null);
      refresh();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return payments;
    const q = search.trim().toLowerCase();
    return payments.filter(p =>
      String(p.payment_ref ?? '').toLowerCase().includes(q)
      || String(p.notes ?? '').toLowerCase().includes(q)
      || String(p.id).includes(q),
    );
  }, [payments, search]);

  const totals = useMemo(() => ({
    count: payments.length,
    amount: payments.reduce((s, p) => s + (Number(p.amount) || 0), 0),
    ops: payments.reduce((s, p) => s + (p.opsCount || 0), 0),
  }), [payments]);

  const currentCarrierName = useMemo(() => {
    const found = carrierList.find(c => c.carrierId === carrier);
    return found?.carrierName || carrier;
  }, [carrier, carrierList]);

  if (loading) return (
    <div style={{ display:'flex', justifyContent:'center', padding:60 }}><Spinner size={22}/></div>
  );

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1300, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <h2 style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', margin: 0 }}>
            💰 الدفعات
          </h2>
          {carrierList.length > 0 && (
            <select value={carrier} onChange={e => setCarrier(e.target.value)}
              style={{
                padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: 'var(--card)', border: '1px solid var(--accent)',
                color: 'var(--text)', cursor: 'pointer', minWidth: 180,
              }}>
              {carrierList.map(c => (
                <option key={c.carrierId} value={c.carrierId}>{c.carrierName || c.carrierId}</option>
              ))}
            </select>
          )}
        </div>
        <Btn size="sm" variant="ghost" icon={<RefreshCw size={14}/>} onClick={refresh}>تحديث</Btn>
      </div>

      <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0, marginBottom: 16 }}>
        كل دفعة تُمثّل تحويلاً بنكياً واحداً غطّى عملية أو أكثر. اضغط على دفعة لعرض الفواتير اللي شملتها.
      </p>

      {payments.length === 0 ? (
        <Card style={{ padding: 44, textAlign: 'center' }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>💸</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>لا توجد دفعات بعد</div>
          <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.7, marginBottom: 22 }}>
            عند تسديد عملية أو مجموعة عمليات من الدفتر، تُسجَّل هنا تلقائياً بإجمالي مفصّل ورقم حوالة وتاريخ.
          </div>
          <Btn variant="accent" size="md" onClick={() => { window.location.href = `/ledger?carrier=${carrier}`; }}>
            افتح كشف الشركة للسداد →
          </Btn>
        </Card>
      ) : (
        <>
          {/* Summary stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px,1fr))', gap: 12, marginBottom: 16 }}>
            <Stat label="إجمالي الدفعات" value={totals.count} color="var(--accent)" big/>
            <Stat label="إجمالي المسدّد" value={fmt(totals.amount)} suffix="ر.س" color="var(--green)" big/>
            <Stat label="عمليات مغطّاة" value={totals.ops} color="var(--accent)"/>
          </div>

          {/* Search */}
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <Search size={14} style={{ position: 'absolute', right: 12, top: 11, color: 'var(--muted)' }}/>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="بحث برقم الحوالة أو الملاحظات..."
              style={{ width: '100%', padding: '9px 36px 9px 12px', borderRadius: 9, fontSize: 13, fontFamily: 'var(--font-mono)' }}/>
          </div>

          {/* Payments list */}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {filtered.length === 0
              ? <Empty icon="🔍" title="لا توجد نتائج" sub="جرب بحثاً مختلفاً"/>
              : (
                <div>
                  {filtered.map(p => (
                    <PaymentRow
                      key={p.id}
                      payment={p}
                      isExpanded={expanded === p.id}
                      ops={opsOf[p.id]}
                      onToggle={() => toggleExpand(p.id)}
                      onDelete={() => setConfirmDelete(p)}
                    />
                  ))}
                </div>
              )
            }
          </Card>
        </>
      )}

      {confirmDelete && (
        <Modal title="⚠️ إلغاء الدفعة" onClose={() => setConfirmDelete(null)} width={420}>
          <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text)', marginBottom: 14 }}>
            سيتم حذف الدفعة #{confirmDelete.id} (<span style={{ fontFamily: 'var(--font-mono)' }}>{fmt(confirmDelete.amount)} ر.س</span>)،
            وإرجاع <strong>{confirmDelete.opsCount}</strong> عملية إلى حالة "معلّقة" مع مسح رقم الحوالة وتاريخ السداد.
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 16 }}>
            استخدمها فقط إذا الدفعة تم إنشاؤها بالخطأ. لا يمكن التراجع عن الحذف.
          </div>
          <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end' }}>
            <Btn variant="ghost" onClick={() => setConfirmDelete(null)}>إلغاء</Btn>
            <Btn variant="danger" onClick={() => handleDelete(confirmDelete.id)}>تأكيد الحذف</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── PaymentRow ────────────────────────────────────────────────────────────
function PaymentRow({ payment, isExpanded, ops, onToggle, onDelete }) {
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <button onClick={onToggle}
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr 1fr 1fr auto auto',
          gap: 16, alignItems: 'center', padding: '14px 18px',
          width: '100%', textAlign: 'right', cursor: 'pointer',
          background: isExpanded ? 'color-mix(in srgb, var(--accent) 4%, transparent)' : 'transparent',
          border: 'none', color: 'inherit', fontFamily: 'inherit',
        }}>
        {isExpanded ? <ChevronDown size={16} color="var(--accent)"/> : <ChevronLeft size={16} color="var(--muted)"/>}
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14, color: 'var(--green)' }}>
            {fmt(payment.amount)} <span style={{ fontSize: 10, color: 'var(--muted)' }}>ر.س</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            دفعة #{payment.id}
          </div>
        </div>
        <div style={{ fontSize: 12 }}>
          <div style={{ color: 'var(--muted)', fontSize: 10 }}>التاريخ</div>
          <div style={{ fontWeight: 600 }}>{payment.paid_at}</div>
        </div>
        <div style={{ fontSize: 12 }}>
          <div style={{ color: 'var(--muted)', fontSize: 10 }}>رقم الحوالة</div>
          <div style={{ fontFamily: 'var(--font-mono)', color: payment.payment_ref ? 'var(--accent)' : 'var(--muted)' }}>
            {payment.payment_ref || '—'}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            display: 'inline-block', background: 'var(--surface)',
            padding: '4px 10px', borderRadius: 999,
            fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
          }}>
            {payment.opsCount} عملية
          </div>
        </div>
        <div onClick={e => { e.stopPropagation(); onDelete(); }}
          style={{
            cursor: 'pointer', color: 'var(--red)',
            padding: '6px 10px', borderRadius: 6, fontSize: 11,
          }}
          title="إلغاء الدفعة">
          <Trash2 size={14}/>
        </div>
      </button>

      {isExpanded && (
        <div style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
          {!ops ? (
            <div style={{ padding: 20, textAlign: 'center' }}><Spinner size={16}/></div>
          ) : ops.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
              لا توجد عمليات لهذه الدفعة
            </div>
          ) : (
            <>
              {payment.notes && (
                <div style={{ padding: '10px 18px', fontSize: 11, color: 'var(--muted)', borderBottom: '1px dashed var(--border)' }}>
                  📝 {payment.notes}
                </div>
              )}
              <table style={{ width: '100%', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--card)' }}>
                    <th style={{ padding: '8px 14px', textAlign: 'right' }}>رقم المستند</th>
                    <th style={{ padding: '8px 14px', textAlign: 'right' }}>النوع</th>
                    <th style={{ padding: '8px 14px', textAlign: 'right' }}>تاريخ المستند</th>
                    <th style={{ padding: '8px 14px', textAlign: 'right' }}>إجمالي العملية</th>
                    <th style={{ padding: '8px 14px', textAlign: 'right' }}>مخصّص لهذه الدفعة</th>
                  </tr>
                </thead>
                <tbody>
                  {ops.map(o => {
                    const amt = (Number(o.amount_dr) || 0) - (Number(o.amount_cr) || 0);
                    const allocated = Number(o.allocated_amount) || 0;
                    const isPartial = allocated > 0 && allocated + 0.01 < Math.abs(amt);
                    return (
                      <tr key={o.id}>
                        <td style={{ padding: '7px 14px', fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{o.doc_no}</td>
                        <td style={{ padding: '7px 14px', fontSize: 11 }}>
                          {o.shipment_type ? SHIPMENT_LABEL[o.shipment_type] : o.doc_type}
                        </td>
                        <td style={{ padding: '7px 14px', fontSize: 11, color: 'var(--muted)' }}>{o.doc_date || '—'}</td>
                        <td style={{ padding: '7px 14px', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                          {fmt(Math.abs(amt))}
                        </td>
                        <td style={{ padding: '7px 14px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: isPartial ? 'var(--gold)' : 'var(--text)' }}>
                          {fmt(allocated)}
                          {isPartial && (
                            <span style={{ marginRight: 6, fontSize: 9, color: 'var(--gold)', fontWeight: 600 }}>
                              · جزئي
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Stat ───────────────────────────────────────────────────────────────
function Stat({ label, value, suffix, color, big }) {
  return (
    <div className="stat-card" style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 11, padding: '13px 16px',
      '--sc-tone': color || 'var(--accent)',
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
