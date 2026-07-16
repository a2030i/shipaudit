// نموذج إنشاء تذكرة دعم (§1.35) — مكوّن مشترك: يُعرض في صفحة /ticket
// المستقلة وفي مودال «تذكرة جديدة» بلوحة /support (نفس المنطق، مصدر واحد).
// الذكاء: AWB إلزامي لأنواع الشحنات فقط · نفس AWB لتذكرة سابقة → إعادة فتح
// تلقائية أو إلحاق (لا تكرار) · إسناد لموظف من النموذج.
import { useState, useEffect, useMemo, useRef } from 'react';
import { LifeBuoy, Search, CheckCircle2, RotateCcw, Link2 } from 'lucide-react';
import { Btn, Input, Select, Spinner, toast, Empty } from './UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadCarriers } from '../lib/coreService.js';
import { loadLatestMerchants } from '../lib/merchantsService.js';
import { loadEmployees } from '../lib/employeeService.js';
import { createTicket, TICKET_CATEGORIES, AWB_REQUIRED_CATEGORIES } from '../lib/supportService.js';
import { normalizeSaudiPhone } from '../lib/whatsappService.js';

// نتيجة الإنشاء بأنواعها الثلاثة — لكلٍّ رسالتها وأيقونتها
const RESULT_META = {
  created:  { icon: CheckCircle2, color: 'var(--green)',  title: 'تم إنشاء التذكرة',
              sub: (t) => 'أعطِ العميل هذا الرقم للمتابعة' },
  reopened: { icon: RotateCcw,    color: '#F97316',       title: 'أُعيد فتح التذكرة تلقائياً',
              sub: (t) => 'نفس رقم الشحنة لتذكرة سابقة محلولة — أُلحقت التفاصيل الجديدة بها' },
  existing: { icon: Link2,        color: '#0EA5E9',       title: 'التذكرة مفتوحة مسبقاً لنفس الشحنة',
              sub: (t) => 'لم تُنشأ تذكرة مكررة — أُضيفت التفاصيل الجديدة إليها' },
};

export default function TicketCreateForm({ prefillPhone = '', onCreated, onClose }) {
  const { can, user, profile } = useAuth();
  const [carriers, setCarriers] = useState([]);
  const [merchants, setMerchants] = useState(null);   // null = يحمّل
  const [employees, setEmployees] = useState([]);
  const [storeQ, setStoreQ] = useState('');
  const [store, setStore] = useState(null);           // المتجر المختار من القائمة
  const [listOpen, setListOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('delayed');
  const [carrierId, setCarrierId] = useState('');
  const [awb, setAwb] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);         // { ticket, created|reopened|existing }
  const boxRef = useRef(null);

  const awbRequired = AWB_REQUIRED_CATEGORIES.includes(category);

  useEffect(() => {
    loadCarriers().then(setCarriers).catch(() => setCarriers([]));
    loadLatestMerchants()
      .then(({ merchants: m }) => setMerchants(m || []))
      .catch(() => setMerchants([]));
    loadEmployees().then(setEmployees).catch(() => setEmployees([]));
  }, []);

  // ?phone= → اختيار المتجر تلقائياً بالهاتف المطبَّع
  useEffect(() => {
    if (!prefillPhone || !merchants?.length || store) return;
    const norm = normalizeSaudiPhone(prefillPhone);
    const hit = merchants.find(m => normalizeSaudiPhone(m.phone) === norm);
    if (hit) { setStore(hit); setStoreQ(hit.store_name); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchants, prefillPhone]);

  // إغلاق قائمة المتاجر عند النقر خارجها
  useEffect(() => {
    const close = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setListOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const matches = useMemo(() => {
    if (!merchants) return [];
    const s = storeQ.trim().toLowerCase();
    if (s.length < 2) return [];
    return merchants
      .filter(m => String(m.store_name || '').toLowerCase().includes(s)
                || String(m.phone || '').includes(s))
      .slice(0, 8);
  }, [merchants, storeQ]);

  const pickStore = (m) => { setStore(m); setStoreQ(m.store_name); setListOpen(false); };

  const submit = async () => {
    const storeName = (store?.store_name || storeQ).trim();
    if (!storeName) return toast('اختر المتجر أو اكتب اسمه', 'error');
    if (!title.trim()) return toast('اكتب عنوان المشكلة', 'error');
    if (awbRequired && !awb.trim()) return toast(`رقم الشحنة AWB إلزامي لنوع «${TICKET_CATEGORIES[category].label}»`, 'error');
    setBusy(true);
    try {
      const carrier = carriers.find(c => c.id === carrierId);
      const emp = employees.find(e => e.id === assignedTo);
      const r = await createTicket({
        storeId: store?.store_id || null,
        storeName,
        customerPhone: store?.phone ? normalizeSaudiPhone(store.phone) : null,
        title: title.trim(),
        description: desc.trim() || null,
        carrierId: carrierId || null,
        carrierName: carrier?.name || null,
        awb: awb.trim() || null,
        category,
        assignedTo: assignedTo || null,
        assigneeName: emp?.name || null,
        userId: user?.id || null,
      });
      setResult(r);
      onCreated?.(r);
    } catch (e) { toast(`فشل إنشاء التذكرة: ${e.message}`, 'error'); }
    setBusy(false);
  };

  const resetForm = () => {
    setResult(null); setStore(null); setStoreQ('');
    setTitle(''); setCategory('delayed'); setCarrierId(''); setAwb(''); setAssignedTo(''); setDesc('');
  };

  if (!can('support.create')) return (
    <div style={{ padding: 30 }}><Empty icon="🔒" title="لا صلاحية" sub="تحتاج صلاحية «إنشاء تذكرة» — اطلبها من المدير"/></div>
  );

  // ── شاشة النتيجة: أُنشئت / أُعيد فتحها / مُلحقة بمفتوحة ──
  if (result) {
    const kind = result.reopened ? 'reopened' : result.existing ? 'existing' : 'created';
    const meta = RESULT_META[kind];
    const Icon = meta.icon;
    return (
      <div style={{ padding: '28px 22px', textAlign: 'center' }}>
        <Icon size={42} color={meta.color} style={{ marginBottom: 10 }}/>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{meta.title}</div>
        <div style={{ fontSize: 30, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--accent)', letterSpacing: 1, marginBottom: 4 }}>{result.ticket.ref}</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 18 }}>
          {result.ticket.storeName}{result.ticket.carrierName ? ` · ${result.ticket.carrierName}` : ''} — {meta.sub(result.ticket)}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Btn variant="ghost" onClick={() => { navigator.clipboard?.writeText(result.ticket.ref); toast('نُسخ الرقم ✓', 'success'); }}>نسخ الرقم</Btn>
          <Btn variant="primary" onClick={resetForm}>تذكرة جديدة</Btn>
          {onClose && <Btn variant="ghost" onClick={onClose}>إغلاق</Btn>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '4px 2px' }}>
      {/* المتجر — بحث مباشر في دليل المتاجر (لا قائمة منسدلة خام) */}
      <div ref={boxRef} style={{ position: 'relative', marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 5 }}>
          المتجر <span style={{ color: 'var(--red)' }}>*</span>
        </label>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', insetInlineStart: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted2)' }}/>
          <input
            value={storeQ}
            onChange={(e) => { setStoreQ(e.target.value); setStore(null); setListOpen(true); }}
            onFocus={() => setListOpen(true)}
            placeholder={merchants == null ? 'يحمّل دليل المتاجر…' : 'اكتب اسم المتجر أو رقم الجوال…'}
            style={{
              width: '100%', padding: '10px 34px 10px 12px', borderRadius: 10,
              border: `1.5px solid ${store ? 'var(--green)' : 'var(--border)'}`,
              background: 'var(--surface)', color: 'var(--text)',
              fontSize: 13.5, fontFamily: 'var(--font-sans)', outline: 'none',
            }}
          />
        </div>
        {store && (
          <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 4 }}>
            ✓ {store.store_name}{store.phone ? ` · ${store.phone}` : ''}
          </div>
        )}
        {!store && storeQ.trim().length >= 2 && !matches.length && merchants != null && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            لا تطابق في الدليل — سيُحفظ الاسم كما كتبته
          </div>
        )}
        {listOpen && matches.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', insetInlineStart: 0, insetInlineEnd: 0, zIndex: 30,
            background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
            marginTop: 4, boxShadow: '0 10px 28px rgba(0,0,0,.14)', overflow: 'hidden',
          }}>
            {matches.map(m => (
              <button key={m.store_id} onClick={() => pickStore(m)} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                width: '100%', padding: '9px 12px', border: 'none', cursor: 'pointer',
                background: 'transparent', textAlign: 'start', fontFamily: 'var(--font-sans)',
                borderBottom: '1px solid var(--border)',
              }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{m.store_name}</span>
                <span style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--font-mono)', direction: 'ltr' }}>{m.phone || ''}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <Input label="عنوان المشكلة *" value={title} onChange={(e) => setTitle(e.target.value)}
        placeholder="مثال: شحنة متأخرة 5 أيام عند العميل" style={{ marginBottom: 14 }}/>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <Select label="نوع المشكلة" value={category} onChange={(e) => setCategory(e.target.value)}>
          {Object.entries(TICKET_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </Select>
        <Select label="شركة الشحن" value={carrierId} onChange={(e) => setCarrierId(e.target.value)}>
          <option value="">غير متعلقة بشركة</option>
          {carriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <div>
          <Input label={awbRequired ? 'رقم الشحنة AWB *' : 'رقم الشحنة AWB'} value={awb}
            onChange={(e) => setAwb(e.target.value)}
            placeholder={awbRequired ? 'إلزامي لمشاكل الشحنات' : 'اختياري'}/>
          {awb.trim() && (
            <div style={{ fontSize: 10.5, color: 'var(--muted2)', marginTop: 3 }}>
              لو سبق فتح تذكرة لنفس الرقم، تُلحق بها تلقائياً بدل التكرار
            </div>
          )}
        </div>
        <Select label="إسنادها لموظف" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
          <option value="">بلا مسؤول الآن</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </Select>
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 5 }}>وصف المشكلة</label>
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={4}
          placeholder="ما قاله العميل بالضبط + أي تفاصيل تساعد على الحل…"
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 10, resize: 'vertical',
            border: '1.5px solid var(--border)', background: 'var(--surface)', color: 'var(--text)',
            fontSize: 13.5, fontFamily: 'var(--font-sans)', outline: 'none',
          }}/>
      </div>

      <Btn variant="primary" size="full" icon={busy ? <Spinner size={15} color="currentColor"/> : <LifeBuoy size={15}/>}
        onClick={submit} disabled={busy}>
        {busy ? 'يُنشئ…' : 'إنشاء التذكرة'}
      </Btn>
      <div style={{ fontSize: 10.5, color: 'var(--muted2)', textAlign: 'center', marginTop: 8 }}>
        تُسجَّل باسمك: {profile?.name || '—'}
      </div>
    </div>
  );
}
