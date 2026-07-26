// شاشة الفعل التالي — «آلة القرار» التي تجعل مركز العمليات أقوى من هاتف:
// قائمة مرتّبة لكل عميل تحتاج إجراءً اليوم، بسبب واضح (ردّ/دين/محفظة/توقّف) +
// الإجراء المقترح + أزرار تنفيذه (اتصال IVR / حملة واتساب / عرض العميل).
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Phone } from 'lucide-react';
import { Card, Btn, Spinner, Empty, PageHeader, toast } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadEmployees } from '../lib/employeeService.js';
import { loadNextBestActions, NBA_META } from '../lib/nextActionsService.js';
import { setRetargetingFollowup, STATUSES } from '../lib/retargetingService.js';
import { normalizeSaudiPhone } from '../lib/whatsappService.js';

// نتائج المتابعة السريعة (إغلاق الحلقة) — تُسجَّل في retargeting_followups + تلمس آخر تواصل.
const OUTCOMES = [
  ['contacted', 'تم التواصل'], ['interested', 'مهتم'], ['no_answer', 'لم يرد'],
  ['needs_followup', 'يحتاج متابعة'], ['returned', 'عاد للشحن'], ['converted', 'تحوّل ✅'],
  ['not_interested', 'غير مهتم'], ['price_issue', 'مشكلة سعر'],
];
import IvrCallButton from '../components/IvrCallButton.jsx';
import WhatsAppSendModal from '../components/WhatsAppSendModal.jsx';

const fmt0 = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const daysAgo = (d) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000) : null;

export default function NextActions({ isActive = true }) {
  const navigate = useNavigate();
  const { user, canAny } = useAuth();
  const [rows, setRows] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [mine, setMine] = useState(false);
  const [group, setGroup] = useState('');       // فلتر المجموعة: '' | تحصيل | مبيعات | تواصل
  const [wa, setWa] = useState(null);           // مستلِم حملة واتساب (عميل واحد)

  const refresh = useCallback(async () => {
    setRows(null);
    try {
      const [list, emp] = await Promise.all([
        loadNextBestActions({ owner: mine ? user?.id || null : null, limit: 400 }),
        loadEmployees().catch(() => []),
      ]);
      setRows(list); setEmployees(emp);
    } catch (e) { toast(`تعذّر التحميل: ${e.message}`, 'error'); setRows([]); }
  }, [mine, user?.id]);
  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh]);

  const nameById = useMemo(() => { const m = new Map(); employees.forEach(e => m.set(e.id, e.name || e.email)); return m; }, [employees]);
  const filtered = useMemo(() => (rows || []).filter(r => !group || NBA_META[r.reasonCode]?.group === group), [rows, group]);
  const totals = useMemo(() => {
    const t = { count: filtered.length, money: 0, byGroup: {} };
    for (const r of filtered) { t.money += r.amount || 0; const g = NBA_META[r.reasonCode]?.group || '—'; t.byGroup[g] = (t.byGroup[g] || 0) + 1; }
    return t;
  }, [filtered]);

  if (!canAny(['collections.view', 'sales.view', 'overview.view'])) return <Pad><Empty icon="🔒" title="لا صلاحية"/></Pad>;

  const recipient = (r) => ({
    to: normalizeSaudiPhone(r.phone), name: r.name, amount: r.amount,
    vars: [r.name || ''], fields: { name: r.name, amount: r.amount, reason: r.reason },
  });

  // إغلاق الحلقة: تسجيل نتيجة المتابعة (يلمس آخر تواصل فيخرج من SLA) + إخراجه من القائمة.
  const recordOutcome = async (r, status) => {
    if (!status) return;
    try {
      await setRetargetingFollowup(r.phone, { status, ownerId: r.ownerId || user?.id || null, touch: true });
      setRows(prev => (prev || []).filter(x => !(x.phone === r.phone && x.reasonCode === r.reasonCode)));
      toast(`سُجّلت النتيجة: ${STATUSES[status]?.label || status}`, 'success');
    } catch (e) { toast(`تعذّر التسجيل: ${e.message}`, 'error'); }
  };

  return (
    <Pad>
      <PageHeader icon={<Phone size={22}/>} title="الفعل التالي" subtitle="قائمة اليوم — كل عميل يحتاج إجراءً الآن، بسببه والإجراء المقترح وأزرار تنفيذه"
        actions={<Btn size="sm" variant="ghost" onClick={refresh} disabled={rows == null}><RefreshCw size={14} className={rows == null ? 'spin' : ''}/></Btn>}/>

      {/* شريط الملخّص */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
        <Kpi label="إجراءات مطلوبة" value={fmt0(totals.count)} color="#06B6D4"/>
        <Kpi label="مال معرّض (دين+محفظة)" value={`${fmt0(totals.money)} ر.س`} color="var(--red)"/>
        <Kpi label="تحصيل" value={fmt0(totals.byGroup['تحصيل'] || 0)} color="var(--red)"/>
        <Kpi label="مبيعات" value={fmt0(totals.byGroup['مبيعات'] || 0)} color="var(--gold)"/>
        <Kpi label="تواصل" value={fmt0(totals.byGroup['تواصل'] || 0)} color="#0EA5E9"/>
      </div>

      {/* الفلاتر */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: 'var(--muted)' }}>
          <input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)}/> المسندة لي فقط
        </label>
        {['', 'متابعة', 'تحصيل', 'مبيعات', 'تواصل'].map(g => (
          <Btn key={g || 'all'} size="sm" variant={group === g ? 'primary' : 'outline'} onClick={() => setGroup(g)}>{g || 'الكل'}</Btn>
        ))}
      </div>

      {rows == null ? <div style={{ padding: 40, textAlign: 'center' }}><Spinner/></div>
        : !filtered.length ? <Empty icon="✅" title="لا إجراءات مطلوبة" sub="لا عميل يحتاج فعلاً الآن بهذا الفلتر."/>
        : (
          <div style={{ display: 'grid', gap: 8 }}>
            {filtered.map((r, i) => {
              const m = NBA_META[r.reasonCode] || { icon: '•', label: r.reasonCode, color: 'var(--muted)' };
              return (
                <Card key={`${r.phone}-${i}`} style={{ padding: '10px 14px', borderInlineStart: `4px solid ${m.color}`, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 16 }}>{m.icon}</span>
                      <b style={{ fontSize: 13.5 }}>{r.name}</b>
                      <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, background: `color-mix(in srgb, ${m.color} 15%, transparent)`, color: m.color }}>{m.label}</span>
                      {r.ownerId && <span style={{ fontSize: 10.5, color: 'var(--muted2)' }}>👤 {nameById.get(r.ownerId) || '—'}</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                      {r.reason} → <b style={{ color: 'var(--text)' }}>{r.action}</b>
                      {r.amount ? <span style={{ color: 'var(--red)', fontWeight: 700 }}> · {fmt0(r.amount)} ر.س</span> : null}
                      {r.lastTouch ? <span> · آخر تواصل قبل {daysAgo(r.lastTouch)} يوم</span> : null}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <IvrCallButton phone={r.phone} name={r.name} fields={{ name: r.name, amount: r.amount }} label size={13}
                      style={{ borderRadius: 999, padding: '7px 12px', background: 'var(--accent)', color: '#fff', border: 'none', fontSize: 12, cursor: 'pointer' }}/>
                    <Btn size="sm" variant="accent" icon={<Phone size={12}/>} onClick={() => setWa(recipient(r))}>حملة</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => navigate('/customer-money?q=' + encodeURIComponent(r.phone))}>عرض</Btn>
                    {/* إغلاق الحلقة: تسجيل النتيجة → يخرج من القائمة + يُنهي SLA */}
                    <select defaultValue="" onChange={e => { recordOutcome(r, e.target.value); e.target.value = ''; }}
                      title="سجّل نتيجة المتابعة" style={{ padding: '6px 8px', borderRadius: 8, fontSize: 11.5, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>
                      <option value="">✓ النتيجة…</option>
                      {OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

      <WhatsAppSendModal open={!!wa} onClose={() => setWa(null)} recipients={wa ? [wa] : []} bucketLabel="الفعل التالي"/>
    </Pad>
  );
}

function Pad({ children }) { return <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>{children}</div>; }
function Kpi({ label, value, color }) {
  return (
    <Card style={{ padding: '12px 14px' }}>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-mono)', color: color || 'var(--text)' }}>{value}</div>
    </Card>
  );
}
