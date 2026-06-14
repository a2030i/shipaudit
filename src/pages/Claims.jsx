// «المطالبات» — سجل حي لكل فرق اكتشفه التدقيق ضد ناقل، حتى الاسترداد.
// Lifecycle buttons move a claim along open → submitted → recovered/waived.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Scale, RefreshCw, Plus, Trash2 } from 'lucide-react';
import { Card, Btn, Input, Select, Modal, Empty, Spinner, toast, PageHeader } from '../components/UI.jsx';
import { loadClaims, createClaim, updateClaim, deleteClaim, summarizeClaims, CLAIM_STATUS } from '../lib/claimsService.js';
import { useAuth } from '../lib/auth.jsx';

const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Claims({ carriers = [], isActive }) {
  const { user } = useAuth();
  const [claims, setClaims]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [modal, setModal]     = useState(false);
  const [form, setForm]       = useState({ carrierId: '', title: '', amount: '', reference: '', notes: '' });
  const [filter, setFilter]   = useState('active'); // active | all

  const nameById = useMemo(() => new Map(carriers.map(c => [c.id, c.name])), [carriers]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setClaims(await loadClaims()); }
    catch (e) { toast(`تعذّر التحميل: ${e.message}`, 'error'); }
    setLoading(false);
  }, []);
  useEffect(() => { if (isActive && !claims) refresh(); }, [isActive, claims, refresh]);

  const submit = async () => {
    if (!form.carrierId || !form.title || !(Number(form.amount) > 0)) {
      toast('الناقل والعنوان والمبلغ مطلوبة', 'warn'); return;
    }
    try {
      await createClaim({ ...form, userId: user?.id });
      toast('سُجّلت المطالبة', 'success');
      setModal(false);
      setForm({ carrierId: '', title: '', amount: '', reference: '', notes: '' });
      refresh();
    } catch (e) { toast(`فشل: ${e.message}`, 'error'); }
  };

  const move = async (c, status) => {
    try {
      const patch = { status };
      if (status === 'recovered') {
        const v = window.prompt('المبلغ المستَرد فعلياً؟', String(c.amount));
        if (v == null) return;
        patch.recovered_amount = +Number(v).toFixed(2);
      }
      await updateClaim(c.id, patch);
      toast('تم التحديث', 'success');
      refresh();
    } catch (e) { toast(`فشل: ${e.message}`, 'error'); }
  };

  const remove = async (c) => {
    if (!window.confirm(`حذف المطالبة «${c.title}»؟`)) return;
    try { await deleteClaim(c.id); toast('حُذفت', 'info'); refresh(); }
    catch (e) { toast(`فشل: ${e.message}`, 'error'); }
  };

  const visible = (claims || []).filter(c => filter === 'all' || c.status === 'open' || c.status === 'submitted');
  const sum = summarizeClaims(claims || []);

  return (
    <div style={{ padding: '28px 32px 80px', maxWidth: 1000, margin: '0 auto' }}>
      <PageHeader
        icon={<Scale size={22}/>}
        title="المطالبات"
        subtitle="كل فرق اكتشفه التدقيق يبقى قيداً حياً حتى يُستَرد أو يُحسم — لا مطالبة تنتسي"
        actions={
          <>
            <Btn size="sm" variant="ghost" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/></Btn>
            <Btn size="sm" variant="primary" onClick={() => setModal(true)}><Plus size={14}/> مطالبة جديدة</Btn>
          </>
        }
      />

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 18 }}>
        {[
          { label: 'مكتشفة (بانتظار الإرسال)', v: sum.openTotal,      n: sum.open,      color: '#D97706' },
          { label: 'قيد المطالبة عند الناقل',   v: sum.submittedTotal, n: sum.submitted, color: '#3B82F6' },
          { label: 'استُردت فعلاً ✓',           v: sum.recoveredTotal, n: sum.recovered, color: '#059669' },
        ].map(k => (
          <Card key={k.label} style={{ padding: '13px 16px' }}>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 5 }}>{k.label} ({k.n})</div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', color: k.color }}>
              {fmt(k.v)} <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>ر.س</span>
            </div>
          </Card>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {[['active', 'النشطة'], ['all', 'الكل']].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} style={{
            padding: '5px 14px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            border: '1px solid', borderColor: filter === k ? 'var(--accent)' : 'var(--border)',
            background: filter === k ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
            color: filter === k ? 'var(--accent)' : 'var(--muted)',
          }}>{l}</button>
        ))}
      </div>

      {!claims && loading && <div style={{ padding: 50, textAlign: 'center' }}><Spinner/></div>}

      {claims && (visible.length === 0
        ? <Card><Empty icon="⚖️" title="لا مطالبات نشطة" sub="سجّل أول مطالبة من زر «مطالبة جديدة» عند اكتشاف فرق"/></Card>
        : (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg2)', textAlign: 'right' }}>
                  {['الناقل', 'المطالبة', 'المرجع', 'المبلغ', 'الحالة', 'إجراء'].map(h => (
                    <th key={h} style={{ padding: '10px 13px', color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map(c => {
                  const st = CLAIM_STATUS[c.status] || CLAIM_STATUS.open;
                  return (
                    <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 13px', fontWeight: 600, whiteSpace: 'nowrap' }}>{nameById.get(c.carrier_id) || c.carrier_id}</td>
                      <td style={{ padding: '10px 13px' }}>
                        {c.title}
                        {c.notes && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{c.notes}</div>}
                      </td>
                      <td style={{ padding: '10px 13px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>{c.reference || '—'}</td>
                      <td style={{ padding: '10px 13px', fontFamily: 'var(--font-mono)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {fmt(c.amount)}
                        {c.status === 'recovered' && Number(c.recovered_amount) !== Number(c.amount) && (
                          <div style={{ fontSize: 10.5, color: '#059669' }}>استُرد {fmt(c.recovered_amount)}</div>
                        )}
                      </td>
                      <td style={{ padding: '10px 13px' }}>
                        <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                          background: `color-mix(in srgb, ${st.color} 12%, transparent)`, color: st.color }}>
                          {st.label}
                        </span>
                      </td>
                      <td style={{ padding: '10px 13px', whiteSpace: 'nowrap' }}>
                        {c.status === 'open' && <Btn size="sm" variant="primary" onClick={() => move(c, 'submitted')}>📤 أُرسلت للناقل</Btn>}
                        {c.status === 'submitted' && (
                          <>
                            <Btn size="sm" variant="success" onClick={() => move(c, 'recovered')}>💰 استُردت</Btn>{' '}
                            <Btn size="sm" variant="ghost" onClick={() => move(c, 'waived')}>تنازل</Btn>
                          </>
                        )}
                        {(c.status === 'recovered' || c.status === 'waived') && (
                          <Btn size="sm" variant="ghost" onClick={() => move(c, 'open')}>↩ إعادة فتح</Btn>
                        )}
                        {' '}<Btn size="sm" variant="ghost" onClick={() => remove(c)} title="حذف"><Trash2 size={12}/></Btn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        ))}

      {modal && (
        <Modal title="⚖️ مطالبة جديدة" onClose={() => setModal(false)} width={480}>
          <Select label="الناقل" value={form.carrierId} onChange={e => setForm(f => ({ ...f, carrierId: e.target.value }))}
            options={[{ value: '', label: '— اختر —' }, ...carriers.map(c => ({ value: c.id, label: c.name }))]}/>
          <Input label="عنوان المطالبة" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="مثال: زيادة رسوم وقود — فواتير مايو"/>
          <Input label="المبلغ (ر.س)" type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}/>
          <Input label="المرجع (اختياري)" value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))}
            placeholder="رقم فاتورة / مراجعة / AWB"/>
          <Input label="ملاحظات (اختياري)" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}/>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <Btn variant="primary" onClick={submit} style={{ flex: 1, justifyContent: 'center' }}>تسجيل</Btn>
            <Btn variant="ghost" onClick={() => setModal(false)}>إلغاء</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
