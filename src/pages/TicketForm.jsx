// «/ticket» — نموذج تذكرة دعم سريع (§1.35). شاشة مستقلة بلا قائمة جانبية:
// موظف الخدمة يرد على العميل في هاتف، يفتح الرابط، يسجّل المشكلة بثوانٍ،
// ويعطي العميل رقماً مرجعياً (TKT-0042). يتطلب دخولاً + صلاحية support.create.
// ?phone=9665... يملأ المتجر تلقائياً (رابط مستقبلي من داخل هاتف).
import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { LifeBuoy, Search, CheckCircle2, ArrowRight } from 'lucide-react';
import { Card, Btn, Input, Select, Spinner, toast, Empty } from '../components/UI.jsx';
import { LamhaMark } from '../components/BrandLogo.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadCarriers } from '../lib/coreService.js';
import { loadLatestMerchants } from '../lib/merchantsService.js';
import { createTicket } from '../lib/supportService.js';
import { normalizeSaudiPhone } from '../lib/whatsappService.js';

export default function TicketForm() {
  const { can, user, profile } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [carriers, setCarriers] = useState([]);
  const [merchants, setMerchants] = useState(null);   // null = يحمّل
  const [storeQ, setStoreQ] = useState('');
  const [store, setStore] = useState(null);           // المتجر المختار من القائمة
  const [listOpen, setListOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [carrierId, setCarrierId] = useState('');
  const [awb, setAwb] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);       // التذكرة بعد النجاح
  const boxRef = useRef(null);

  useEffect(() => {
    loadCarriers().then(setCarriers).catch(() => setCarriers([]));
    loadLatestMerchants()
      .then(({ merchants: m }) => setMerchants(m || []))
      .catch(() => setMerchants([]));
  }, []);

  // ?phone= → اختيار المتجر تلقائياً بالهاتف المطبَّع
  useEffect(() => {
    const p = searchParams.get('phone');
    if (!p || !merchants?.length || store) return;
    const norm = normalizeSaudiPhone(p);
    const hit = merchants.find(m => normalizeSaudiPhone(m.phone) === norm);
    if (hit) { setStore(hit); setStoreQ(hit.store_name); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchants, searchParams]);

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
    setBusy(true);
    try {
      const carrier = carriers.find(c => c.id === carrierId);
      const t = await createTicket({
        storeId: store?.store_id || null,
        storeName,
        customerPhone: store?.phone ? normalizeSaudiPhone(store.phone) : null,
        title: title.trim(),
        description: desc.trim() || null,
        carrierId: carrierId || null,
        carrierName: carrier?.name || null,
        awb: awb.trim() || null,
        userId: user?.id || null,
      });
      setCreated(t);
    } catch (e) { toast(`فشل إنشاء التذكرة: ${e.message}`, 'error'); }
    setBusy(false);
  };

  const resetForm = () => {
    setCreated(null); setStore(null); setStoreQ('');
    setTitle(''); setCarrierId(''); setAwb(''); setDesc('');
  };

  const shell = (children) => (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '28px 14px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <LamhaMark size={34}/>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>تذكرة دعم جديدة</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>سجّل مشكلة العميل قبل أن تضيع من المحادثة</div>
        </div>
      </div>
      {children}
      {can('support.view') && (
        <button onClick={() => navigate('/support')} style={{
          marginTop: 16, border: 'none', background: 'transparent', cursor: 'pointer',
          color: 'var(--accent)', fontSize: 12.5, fontFamily: 'var(--font-sans)', fontWeight: 600,
          display: 'inline-flex', alignItems: 'center', gap: 5,
        }}>
          لوحة متابعة التذاكر <ArrowRight size={13} style={{ transform: 'scaleX(-1)' }}/>
        </button>
      )}
    </div>
  );

  if (!can('support.create')) return shell(
    <Card style={{ width: '100%', maxWidth: 560, padding: 40 }}>
      <Empty icon="🔒" title="لا صلاحية" sub="تحتاج صلاحية «إنشاء تذكرة» — اطلبها من المدير"/>
    </Card>
  );

  // ── شاشة النجاح: الرقم المرجعي بارز لينسخه الموظف للعميل ──
  if (created) return shell(
    <Card style={{ width: '100%', maxWidth: 560, padding: '32px 26px', textAlign: 'center' }}>
      <CheckCircle2 size={42} color="var(--green)" style={{ marginBottom: 10 }}/>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>تم إنشاء التذكرة</div>
      <div style={{ fontSize: 30, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--accent)', letterSpacing: 1, marginBottom: 4 }}>{created.ref}</div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 18 }}>
        {created.storeName}{created.carrierName ? ` · ${created.carrierName}` : ''} — أعطِ العميل هذا الرقم للمتابعة
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Btn variant="ghost" onClick={() => { navigator.clipboard?.writeText(created.ref); toast('نُسخ الرقم ✓', 'success'); }}>نسخ الرقم</Btn>
        <Btn variant="primary" onClick={resetForm}>تذكرة جديدة</Btn>
      </div>
    </Card>
  );

  return shell(
    <Card style={{ width: '100%', maxWidth: 560, padding: '24px 22px' }}>
      {/* المتجر — بحث مباشر في دليل المتاجر (1,491 متجر — لا قائمة منسدلة خام) */}
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
        <Select label="شركة الشحن" value={carrierId} onChange={(e) => setCarrierId(e.target.value)}>
          <option value="">غير متعلقة بشركة</option>
          {carriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Input label="رقم الشحنة AWB" value={awb} onChange={(e) => setAwb(e.target.value)}
          placeholder="اختياري" style={{ direction: 'ltr' }}/>
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
    </Card>
  );
}
