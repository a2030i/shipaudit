// إرسال حملة واتساب عبر Hatif/Voxa — معاينة → تأكيد → نتائج.
// External action: nothing is sent until the operator presses «إرسال الآن».
// The API key lives only in the edge function; this UI never sees it.

import { useState, useEffect, useMemo } from 'react';
import { MessageCircle, ShieldCheck, Send, X, AlertTriangle, CheckCircle2, Clock, Plus, Minus } from 'lucide-react';
import { Modal, Btn, Spinner, toast } from './UI.jsx';
import { loadWhatsAppConfig, verifyWhatsAppKey, sendWhatsAppCampaign, loadWhatsAppCampaignStatus, saveTemplateVarMap, loadCampaignNames, loadCampaignPhones, loadCampaignRecipientContext, loadNoWhatsappSet } from '../lib/whatsappService.js';
import { scheduleCampaign } from '../lib/retargetingService.js';
import { useAuth } from '../lib/auth.jsx';

const fmt = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

// ── ربط متغيرات القالب بأعمدة الصفحة (2026-07-21) ─────────────────────
// كل مستلِم قد يحمل fields:{...} من صفحته — الكتالوج يعرّب المفاتيح المعروفة.
// «افتراضي الصفحة {{i}}» = سلوك vars القديم (لا كسر لأي صفحة لم تُخصَّص).
const FIELD_LABELS = {
  name:         'اسم المتجر/العميل',
  amount:       'المبلغ / المديونية',
  count:        'عدد الفواتير',
  shipments:    'عدد الشحنات',
  last_shipment:'تاريخ آخر شحنة',
  days_since:   'أيام منذ آخر شحنة',
  wallet:       'رصيد المحفظة',
  billing_type: 'نوع الفوترة',
  store_status: 'حالة المتجر',
  zoho_due:     'مديونية زوهو المفتوحة',
  zoho_open_count: 'عدد فواتير زوهو المفتوحة',
  zoho_last_invoice: 'تاريخ آخر فاتورة (زوهو)',
  zoho_last_payment: 'تاريخ آخر دفعة (زوهو)',
  overdue:      'المبلغ المتأخر',
  oldest_days:  'عمر أقدم فاتورة (يوم)',
  last_payment: 'تاريخ آخر دفعة',
  first_seen:   'أول ظهور في هاتف',
  category:     'القسم',
  platform:     'المنصّة',
  phone:        'رقم الجوال',
};
// fields = حقول الصفحة مدموجة فوق سياق القاعدة (campaign_recipient_context)
const fieldValue = (fields, r, key) => {
  const v = (fields && fields[key] !== undefined) ? fields[key]
    : (key === 'name' ? r.name : key === 'amount' ? r.amount : key === 'count' ? r.count : undefined);
  if (v == null || v === '') return '—';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    try { return new Date(v).toLocaleDateString('ar-SA', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return v.slice(0, 10); }
  }
  if (typeof v === 'number') return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return String(v);
};

// recipients: [{ to, name, amount, count, vars:[] }]
// البوابة المركزية: الإرسال يتطلّب campaigns.send — تُفحَص هنا مرة واحدة فتحمي
// كل الصفحات التي تفتح المودال (والدالة hatif-send تعيد الفحص سيرفرياً).
export default function WhatsAppSendModal({ open, onClose, recipients = [], bucketLabel, onSent }) {
  const { user, can } = useAuth();
  const [cfg, setCfg]       = useState(null);
  const [verifying, setVer] = useState(false);
  const [verified, setVerified] = useState(null); // null | true | false
  const [sending, setSending]   = useState(false);
  const [results, setResults]   = useState(null);
  const [progress, setProgress] = useState(null);   // {done,total,sent,failed} أثناء الدفعات
  const [selected, setSelected] = useState(() => new Set());   // أرقام المستلِمين المختارين
  const [tpl, setTpl]           = useState('');                // القالب المختار لهذه الحملة
  const [waStatus, setWaStatus] = useState(() => new Map());   // آخر حملة/رقم — لتحذير التكرار
  const [schedOn, setSchedOn]   = useState(false);             // ⏰ جدولة بدل الإرسال الآن
  const [schedAt, setSchedAt]   = useState('');
  // ربط متغيرات القالب: [{src:'legacy'|'custom'|'field:<key>', text?}] لكل {{i}}
  const [varMap, setVarMap]     = useState([]);
  // نظام الحملات (2026-07-21): اسم إلزامي + استثناء مستلمي حملات سابقة
  const [campName, setCampName]   = useState('');
  const [campaigns, setCampaigns] = useState([]);          // الحملات السابقة (اسم/عدد/آخر إرسال)
  const [exCamps, setExCamps]     = useState(() => new Set());  // أسماء الحملات المستثناة
  const [exPhones, setExPhones]   = useState(() => new Set());  // أرقامها (تُجلب عند الاختيار)
  const [exOpen, setExOpen]       = useState(false);
  // سياق واسع لكل مستلم من القاعدة (شحنات/محفظة/زوهو…) — حقول الصفحة تفوز عند التعارض
  const [ctx, setCtx]             = useState(() => new Map());
  // أرقام بلا واتساب — تُستبعَد آلياً من كل حملة (لا استثناء يدوي)
  const [noWa, setNoWa]          = useState(() => new Set());

  // الربط الافتراضي لقالبٍ ما: المحفوظ في الإعدادات (يُحترَم حتى لو **فارغ** —
  // قالب بلا متغيرات)، وإلا «افتراضي الصفحة» بعدد vars.
  const defaultMapFor = (templateName, config) => {
    const saved = config?.templateVars?.[templateName];
    if (Array.isArray(saved)) return saved.map(m => ({ src: m.src || 'legacy', text: m.text || '' }));
    const n = Math.max(1, recipients[0]?.vars?.length || 1);
    return Array.from({ length: Math.min(n, 5) }, () => ({ src: 'legacy', text: '' }));
  };

  useEffect(() => {
    if (!open) return;
    setResults(null); setVerified(null); setSchedOn(false); setSchedAt('');
    setCampName(bucketLabel || ''); setExCamps(new Set()); setExPhones(new Set()); setExOpen(false);
    setSelected(new Set(recipients.filter(r => r.to && r.to.length >= 11).map(r => r.to)));  // الكل افتراضياً
    loadCampaignNames().then(setCampaigns).catch(() => setCampaigns([]));
    setCtx(new Map());
    loadCampaignRecipientContext(recipients.map(r => r.to)).then(setCtx).catch(() => {});
    loadNoWhatsappSet().then(setNoWa).catch(() => {});
    loadWhatsAppConfig()
      .then(c => {
        setCfg(c);
        const t = c.templateName || (c.templates || [])[0] || '';
        setTpl(t);
        setVarMap(defaultMapFor(t, c));
      })
      .catch(() => { setCfg({ templates: [], templateName: '', templateLanguage: 'ar' }); setTpl(''); setVarMap([{ src: 'legacy', text: '' }]); });
    loadWhatsAppCampaignStatus().then(setWaStatus).catch(() => {});
  }, [open]);

  // تغيير القالب → تحميل ربطه المحفوظ (أو الافتراضي)
  const pickTemplate = (t) => { setTpl(t); setVarMap(defaultMapFor(t, cfg)); };

  // اختيار سياق المتجر الصحيح للمستلم (حادثة TREVU/farnearapp — رقم واحد بمتاجر
  // عدة): متجر واحد على الرقم = يُؤخذ؛ متاجر عدة = فقط ما يطابق اسم المستلم؛
  // لا تطابق = لا سياق متجر إطلاقاً (رسالة ناقصة أفضل من رسالة ببيانات متجر آخر).
  const normName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const pickCtx = (r) => {
    const arr = ctx.get(r.to);
    if (!arr?.length) return null;
    if (arr.length === 1) return arr[0];
    return arr.find(x => normName(x._store) === normName(r.name)) || null;
  };
  // حقول مستلِم = سياق متجره الصحيح + حقول صفحته فوقه (تفوز عند التعارض)
  const mergedFields = (r) => ({ ...(pickCtx(r) || {}), ...(r.fields || {}) });

  // الحقول المتاحة: اتحاد حقول الصفحة + سياق القاعدة عبر المستلمين (بلا مفاتيح _ الداخلية)
  const availableFields = useMemo(() => {
    const keys = new Set(['name']);
    for (const r of recipients) {
      if (r.amount != null) keys.add('amount');
      if (r.count != null) keys.add('count');
      const f = mergedFields(r);
      for (const k of Object.keys(f)) if (!k.startsWith('_') && f[k] != null && f[k] !== '') keys.add(k);
    }
    return [...keys];
  }, [recipients, ctx]);

  // حلّ متغيرات مستلِم واحد وفق الربط الحالي
  const resolveVarsFor = (r) => varMap.map((m, i) => {
    if (m.src === 'legacy') return String(r.vars?.[i] ?? r.name ?? '');
    if (m.src === 'custom') return m.text || '';
    if (m.src.startsWith('field:')) return fieldValue(mergedFields(r), r, m.src.slice(6));
    return '';
  });
  // «مخصَّص» = ربط غير افتراضي **أو** إفراغ المتغيرات (قالب بلا متغيرات) — كلاهما
  // يجب أن يُحفظ للقالب حتى لا يُعاد المتغير الافتراضي في المرة القادمة.
  const mapCustomized = varMap.length === 0 || varMap.some(m => m.src !== 'legacy');

  if (!open) return null;

  if (!can('campaigns.send')) {
    return (
      <Modal title="📲 إرسال حملة واتساب" onClose={onClose} width={440}>
        <div style={{ padding: '18px 6px', textAlign: 'center', fontSize: 13, color: 'var(--muted)', lineHeight: 1.8 }}>
          🔒 لا تملك صلاحية <b style={{ color: 'var(--text)' }}>إطلاق حملات واتساب</b>.<br/>
          اطلب من المدير منحك «إطلاق حملة واتساب» من شاشة الفريق والصلاحيات.
        </div>
        <div style={{ textAlign: 'left' }}><Btn variant="ghost" onClick={onClose}>إغلاق</Btn></div>
      </Modal>
    );
  }

  // استثناء مستلمي الحملات المحددة — الرقم المرسَل له في أي منها لا يُرسَل ثانية
  const toggleExCampaign = async (name) => {
    const next = new Set(exCamps);
    next.has(name) ? next.delete(name) : next.add(name);
    setExCamps(next);
    try { setExPhones(await loadCampaignPhones([...next])); }
    catch { toast('تعذّر جلب أرقام الحملة المستثناة', 'error'); }
  };

  // إزالة تكرار الهاتف (حادثة 2026-07-21: رقم بعدة متاجر = عدة مستلمين فاستلم
  // 3 رسائل في 37 ثانية → خطر حظر الرقم التجاري). أول صف للرقم يفوز (الأعلى
  // شحناً غالباً — الصفحات ترتّب تنازلياً)، مع الاحتفاظ بحقوله للمعاينة.
  const validAll = (() => {
    const seen = new Set(); const out = [];
    for (const r of recipients) {
      if (!r.to || r.to.length < 11 || seen.has(r.to)) continue;
      seen.add(r.to); out.push(r);
    }
    return out;
  })();
  const dupSkipped = recipients.filter(r => r.to && r.to.length >= 11).length - validAll.length;
  // استبعاد آلي لمن ليس له واتساب (فشل «الرقم غير موجود») — لا استثناء يدوي
  const noWaCount = validAll.filter(r => noWa.has(r.to)).length;
  const excludedCount = validAll.filter(r => exPhones.has(r.to) && !noWa.has(r.to)).length;
  const valid = validAll.filter(r => !exPhones.has(r.to) && !noWa.has(r.to));
  const skipped = recipients.filter(r => !(r.to && r.to.length >= 11)).length;
  const selectedValid = valid.filter(r => selected.has(r.to));
  // لا حدّ للعدد: الفوري يُقسَّم دفعات 60 متتالية — القياس الفعلي ≈ ثانية/رسالة
  // (إرسال هاتف + التسجيل الفوري)، فدفعة 60 ≈ دقيقة، بأمان تحت مهلة الدالة 150ث.
  // (120 سابقاً لامست المهلة وقُتلت 504 على حملة 290). الكبير الأفضل جدولته.
  const SEND_CHUNK = 60;
  const lastSentOf = (to) => waStatus.get(to)?.lastSentAt || null;
  const daysAgoTxt = (iso) => {
    if (!iso) return null;
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    return d === 0 ? 'اليوم' : `قبل ${d} يوم`;
  };

  // حماية الإفراط: مَن أُرسل له خلال آخر 7 أيام (من أي تبويب/حملة)
  const recentDays = 7;
  const isRecent = (to) => {
    const st = waStatus.get(to);
    return !!(st?.lastSentAt && (Date.now() - new Date(st.lastSentAt).getTime()) < recentDays * 86_400_000);
  };
  const recentSelected = selectedValid.filter(r => isRecent(r.to));
  const excludeRecent = () => setSelected(prev => {
    const n = new Set(prev);
    for (const r of recentSelected) n.delete(r.to);
    return n;
  });

  const toggle = (to) => setSelected(prev => { const n = new Set(prev); n.has(to) ? n.delete(to) : n.add(to); return n; });
  const allOn  = () => setSelected(new Set(valid.map(r => r.to)));
  const allOff = () => setSelected(new Set());

  const doVerify = async () => {
    setVer(true); setVerified(null);
    const r = await verifyWhatsAppKey();
    setVer(false);
    if (r?.ok) { setVerified(true); toast('المفتاح يعمل ✓', 'success'); }
    else { setVerified(false); toast(`فشل التحقق: ${r?.error || 'غير معروف'}`, 'error'); }
  };

  // جدولة بدل الإرسال الآن — تُكتب في campaign_queue وينفّذها campaign-runner
  // (scheduleCampaign تقسّم المستلمين صفوف طابور 150/دفعة — لا حدّ للعدد هنا)
  const doSchedule = async () => {
    if (!campName.trim()) { toast('اكتب اسماً للحملة أولاً', 'warn'); return; }
    if (!tpl) { toast('اختر قالباً أولاً', 'warn'); return; }
    if (!selectedValid.length) { toast('اختر مستلِماً واحداً على الأقل', 'warn'); return; }
    if (!schedAt || new Date(schedAt).getTime() < Date.now() + 5 * 60_000) {
      toast('اختر وقتاً مستقبلياً (بعد 5 دقائق على الأقل)', 'warn'); return;
    }
    setSending(true);
    try {
      const batches = await scheduleCampaign({
        scheduledAt: new Date(schedAt).toISOString(), templateName: tpl,
        recipients: selectedValid.map(v => ({ to: v.to, vars: resolveVarsFor(v), name: v.name, amount: v.amount })),
        bucketLabel: campName.trim(), userId: user?.id || null,
      });
      if (mapCustomized) saveTemplateVarMap(tpl, varMap).catch(() => {});
      toast(`⏰ جُدولت «${campName.trim()}» (${fmt(selectedValid.length)} مستلم على ${batches} دفعة) — تبدأ ${new Date(schedAt).toLocaleString('ar-SA')}`, 'success');
      onSent?.({ scheduled: true });
      onClose?.();
    } catch (e) { toast(`فشلت الجدولة: ${e.message}`, 'error'); }
    setSending(false);
  };

  // إرسال فوري بلا حدّ للعدد: دفعات SEND_CHUNK متتالية (كل استدعاء تحت مهلة
  // الدالة) — النتائج تُجمَّع، والتقدّم يظهر حياً. لا تُغلق النافذة أثناءها.
  const doSend = async () => {
    if (schedOn) return doSchedule();
    if (!campName.trim()) { toast('اكتب اسماً للحملة أولاً', 'warn'); return; }
    if (!tpl) { toast('اختر قالباً — أو أضفه من «إعدادات واتساب»', 'warn'); return; }
    if (!selectedValid.length) { toast('اختر مستلِماً واحداً على الأقل', 'warn'); return; }
    setSending(true);
    const items = selectedValid.map(v => ({ to: v.to, vars: resolveVarsFor(v), name: v.name, amount: v.amount }));
    const agg = { ok: true, total: items.length, sent: 0, failed: 0, results: [] };
    const batches = Math.ceil(items.length / SEND_CHUNK);
    setProgress({ done: 0, total: items.length, sent: 0, failed: 0, batch: 1, batches });
    let hardError = null;
    for (let i = 0; i < items.length; i += SEND_CHUNK) {
      const chunk = items.slice(i, i + SEND_CHUNK);
      const batch = Math.floor(i / SEND_CHUNK) + 1;
      // تقدير حي أثناء الدفعة (~رسالة/ثانية داخل الدالة) — العدّاد كان يجمد
      // على 0 طوال الدقيقة الأولى فبدا الإرسال معلّقاً وهو يعمل
      const t0 = Date.now();
      const ticker = setInterval(() => {
        const guess = Math.min(chunk.length - 1, Math.floor((Date.now() - t0) / 1000));
        setProgress({ done: i + guess, total: items.length, sent: agg.sent + guess, failed: agg.failed, batch, batches, estimating: true });
      }, 1000);
      let r;
      try {
        r = await sendWhatsAppCampaign({
          templateName: tpl, templateLanguage: 'ar', channelId: null, items: chunk,
          campaign: { name: campName.trim(), bucket: bucketLabel || null, userId: user?.id || null },
        });
      } finally { clearInterval(ticker); }
      if (r?.ok) {
        agg.sent += r.sent || 0; agg.failed += r.failed || 0;
        if (Array.isArray(r.results)) agg.results.push(...r.results);
      } else {
        // فشل الدفعة كلها (شبكة/مهلة) — نتوقف ونعرض ما أُنجز حتى لا نكرّر المُرسَل
        hardError = r?.error || 'انقطاع أثناء الإرسال';
        agg.failed += chunk.length;
        agg.results.push(...chunk.map(c => ({ to: c.to, ok: false, error: hardError })));
        break;
      }
      setProgress({ done: Math.min(i + SEND_CHUNK, items.length), total: items.length, sent: agg.sent, failed: agg.failed, batch: Math.min(batch + 1, batches), batches });
    }
    if (mapCustomized) saveTemplateVarMap(tpl, varMap).catch(() => {});
    setSending(false); setProgress(null);
    setResults(agg);
    if (hardError) toast(`توقّف الإرسال: ${hardError} — نجحت ${agg.sent} قبل التوقف`, 'error');
    else toast(`تم الإرسال — ${agg.sent} نجحت · ${agg.failed} فشلت`, (agg.failed ? 'warn' : 'success'));
    onSent?.(agg);
  };

  return (
    <Modal title="📲 إرسال حملة واتساب" onClose={onClose} width={560}>
      {!cfg ? <div style={{ padding: 40, textAlign: 'center' }}><Spinner/></div> : results ? (
        // ── Results view ──
        <div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
            <ResultStat label="نجحت" value={results.sent || 0} color="var(--green2)"/>
            <ResultStat label="فشلت" value={results.failed || 0} color={results.failed ? 'var(--red)' : '#6B7280'}/>
            <ResultStat label="الإجمالي" value={results.total || valid.length} color="#3B82F6"/>
          </div>
          {/* الفاشلون فقط. الحقل من hatif-send اسمه **ok** لا success — الفلترة على
              success (غير موجود) كانت تُظهر كل النتائج كفاشلة رغم نجاحها. */}
          {Array.isArray(results.results) && results.results.some(x => !x.ok) && (
            <div style={{ maxHeight: 200, overflow: 'auto', fontSize: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
              {results.results.filter(x => !x.ok).map((x, i) => (
                <div key={i} style={{ padding: '7px 11px', borderTop: i ? '1px solid var(--border)' : 'none', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', direction: 'ltr' }}>{x.to}</span>
                  <span style={{ color: 'var(--red)' }}>{x.error || 'فشل'}</span>
                </div>
              ))}
            </div>
          )}
          {results.sent > 0 && !results.failed && (
            <div style={{ fontSize: 12, color: 'var(--green2)', background: 'color-mix(in srgb, var(--green) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--green) 28%, transparent)', borderRadius: 8, padding: '9px 12px' }}>
              ✅ أُرسلت كل الرسائل بنجاح — تابع حالتها (وصلت/قُرئت/ردّ) في «سجل الحملات».
            </div>
          )}
          <div style={{ marginTop: 16, textAlign: 'left' }}>
            <Btn variant="primary" onClick={onClose}>تم</Btn>
          </div>
        </div>
      ) : (
        // ── اختيار المستلِمين + إرسال (القالب/القناة/اللغة مثبّتة من الإعدادات) ──
        <div>
          {/* اسم الحملة — إلزامي (يظهر في السجل ويُستخدم للاستثناء مستقبلاً) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>اسم الحملة <span style={{ color: 'var(--red)' }}>*</span></span>
            <input value={campName} onChange={e => setCampName(e.target.value)} placeholder="مثال: تحصيل متأخرين يوليو"
              style={{ flex: 1, fontSize: 12.5, padding: '7px 11px', borderRadius: 8,
                border: `1px solid ${campName.trim() ? 'var(--border)' : 'var(--red)'}`, background: 'var(--bg)', color: 'var(--text)' }}/>
          </div>

          {/* استثناء مستلمي حملات سابقة — لا يُرسَل لمن سبق استهدافه فيها */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 9, marginBottom: 10, background: 'var(--surface2)' }}>
            <button onClick={() => setExOpen(o => !o)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', fontSize: 12, fontWeight: 700 }}>
              <span>{exOpen ? '▾' : '◂'}</span> استثناء من حملات سابقة
              {exCamps.size > 0 && (
                <span style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 600 }}>
                  {exCamps.size} حملة — استُبعد {excludedCount} مستلم
                </span>
              )}
              <span style={{ marginInlineStart: 'auto', fontSize: 10.5, color: 'var(--muted2)', fontWeight: 400 }}>
                من أُرسل له في الحملات المحددة لن يُرسَل ثانية
              </span>
            </button>
            {exOpen && (
              <div className="m-flow" style={{ maxHeight: 170, overflowY: 'auto', borderTop: '1px solid var(--border)' }}>
                {campaigns.length === 0 && <div style={{ padding: 12, fontSize: 11.5, color: 'var(--muted)' }}>لا حملات سابقة</div>}
                {campaigns.map(c => (
                  <label key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}>
                    <input type="checkbox" checked={exCamps.has(c.name)} onChange={() => toggleExCampaign(c.name)}/>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                    <span style={{ fontSize: 10.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{c.sends} رسالة</span>
                    {c.lastAt && <span style={{ fontSize: 10.5, color: 'var(--muted2)' }}>{daysAgoTxt(c.lastAt)}</span>}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* اختيار القالب لهذه الحملة (القائمة من «إعدادات واتساب») + تحقّق سريع */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12,
            background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 12px' }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>القالب:</span>
            {(cfg.templates || []).length > 0 ? (
              <select value={tpl} onChange={e => pickTemplate(e.target.value)}
                style={{ fontSize: 12.5, padding: '5px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                {(cfg.templates || []).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--red)' }}>لا قوالب — أضف من «إعدادات واتساب»</span>
            )}
            <Btn size="sm" variant="ghost" onClick={doVerify} disabled={verifying} style={{ marginInlineStart: 'auto' }}>
              <ShieldCheck size={13}/> {verifying ? 'تحقّق…' : 'تحقّق'}
            </Btn>
            {verified === true  && <span style={{ color: 'var(--green2)', fontSize: 12 }}><CheckCircle2 size={13}/></span>}
            {verified === false && <span style={{ color: 'var(--red)', fontSize: 12 }}><X size={13}/></span>}
          </div>

          {/* ── ربط متغيرات القالب بأعمدة الصفحة (يُحفَظ لكل قالب) ── */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px', marginBottom: 12, background: 'var(--surface2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>متغيرات القالب</span>
              <span style={{ fontSize: 10.5, color: 'var(--muted2)' }}>اربط كل {'{{i}}'} بعمود من هذه الصفحة — يُحفظ للقالب تلقائياً</span>
              <span style={{ marginInlineStart: 'auto', display: 'inline-flex', gap: 4 }}>
                <button onClick={() => setVarMap(m => m.length < 5 ? [...m, { src: 'legacy', text: '' }] : m)} title="إضافة متغير"
                  style={{ border: '1px solid var(--border)', background: 'var(--bg)', borderRadius: 6, cursor: 'pointer', padding: '2px 6px', color: 'var(--text)' }}><Plus size={11}/></button>
                <button onClick={() => setVarMap(m => m.length > 0 ? m.slice(0, -1) : m)} title="حذف آخر متغير"
                  style={{ border: '1px solid var(--border)', background: 'var(--bg)', borderRadius: 6, cursor: 'pointer', padding: '2px 6px', color: 'var(--text)' }}><Minus size={11}/></button>
              </span>
            </div>
            {varMap.length === 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--muted)', padding: '4px 2px' }}>
                لا متغيرات — قالب ثابت (لن يُرسَل أي متغيّر). اضغط ＋ لإضافة متغيّر إن احتجت.
              </div>
            )}
            {varMap.map((m, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--accent)', minWidth: 44, direction: 'ltr', textAlign: 'left' }}>{`{{${i + 1}}}`}</span>
                <select value={m.src} onChange={e => setVarMap(prev => prev.map((x, j) => j === i ? { ...x, src: e.target.value } : x))}
                  style={{ fontSize: 12, padding: '4px 8px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', minWidth: 170 }}>
                  <option value="legacy">افتراضي الصفحة</option>
                  {availableFields.map(k => <option key={k} value={`field:${k}`}>{FIELD_LABELS[k] || k}</option>)}
                  <option value="custom">نص ثابت…</option>
                </select>
                {m.src === 'custom' && (
                  <input value={m.text} onChange={e => setVarMap(prev => prev.map((x, j) => j === i ? { ...x, text: e.target.value } : x))}
                    placeholder="اكتب النص الثابت…"
                    style={{ flex: 1, minWidth: 140, fontSize: 12, padding: '4px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}/>
                )}
                {selectedValid[0] && (
                  <span style={{ fontSize: 11, color: 'var(--green2)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160, whiteSpace: 'nowrap' }}
                    title={resolveVarsFor(selectedValid[0])[i]}>
                    ← {resolveVarsFor(selectedValid[0])[i]}
                  </span>
                )}
              </div>
            ))}
            {selectedValid[0] && varMap.length > 0 && (
              <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 4 }}>
                المعاينة على أول مستلِم: <b>{selectedValid[0].name || selectedValid[0].to}</b>
              </div>
            )}
          </div>

          {/* اختيار المستلِمين */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12.5, flexWrap: 'wrap' }}>
            <b>المستلِمون: {selectedValid.length} / {valid.length}</b>
            <Btn size="sm" variant="ghost" onClick={allOn}>تحديد الكل</Btn>
            <Btn size="sm" variant="ghost" onClick={allOff}>إلغاء الكل</Btn>
            {(skipped > 0 || dupSkipped > 0 || noWaCount > 0) && (
              <span style={{ color: 'var(--muted)', marginInlineStart: 'auto' }}>
                {skipped > 0 && `تُخطّي ${skipped} بلا رقم`}{skipped > 0 && (dupSkipped > 0 || noWaCount > 0) && ' · '}
                {dupSkipped > 0 && `دُمج ${dupSkipped} مكرّر`}{dupSkipped > 0 && noWaCount > 0 && ' · '}
                {noWaCount > 0 && <span style={{ color: 'var(--red)' }}>🚫 استُبعد {noWaCount} بلا واتساب/محظور</span>}
              </span>
            )}
          </div>
          <div className="m-flow" style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 12 }}>
            {valid.slice(0, 400).map((r, i) => {
              const last = daysAgoTxt(lastSentOf(r.to));
              return (
                <label key={r.to + i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                  borderTop: i ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}>
                  <input type="checkbox" checked={selected.has(r.to)} onChange={() => toggle(r.to)}/>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || r.to}</span>
                    <span style={{ display: 'block', fontSize: 10.5, color: last ? 'var(--gold)' : 'var(--muted2)' }}>
                      {last ? `آخر رسالة: ${last}` : 'لم تُراسَل من قبل'}
                    </span>
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--muted)', direction: 'ltr' }}>{r.to}</span>
                  {r.amount != null && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--gold)' }}>{fmt(r.amount)}</span>}
                </label>
              );
            })}
            {valid.length > 400 && (
              <div style={{ padding: '8px 12px', fontSize: 11.5, color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>
                … و{valid.length - 400} مستلماً آخر (معروض أول 400 — «تحديد الكل» يشملهم جميعاً)
              </div>
            )}
            {!valid.length && <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>لا مستلِمون بأرقام صالحة</div>}
          </div>

          {selectedValid.length > SEND_CHUNK && !schedOn && (
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.7 }}>
              ℹ️ {fmt(selectedValid.length)} مستلم — يُرسَلون فوراً على {Math.ceil(selectedValid.length / SEND_CHUNK)} دفعات متتالية
              (≈{Math.ceil(selectedValid.length / 80)} دقيقة، أبقِ النافذة مفتوحة). أو فعّل الجدولة ليرسلها النظام في الخلفية.
            </div>
          )}

          {progress && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ height: 8, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.round(progress.done / Math.max(1, progress.total) * 100)}%`,
                  background: 'var(--green)', transition: 'width .4s' }}/>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
                يُرسِل… {progress.estimating ? '~' : ''}{fmt(progress.done)} / {fmt(progress.total)}
                {progress.batches > 1 ? ` · الدفعة ${progress.batch}/${progress.batches}` : ''}
                {progress.failed ? ` · فشلت ${fmt(progress.failed)}` : ''} — لا تُغلق النافذة
              </div>
            </div>
          )}

          {/* حماية الإفراط في المراسلة — عبر كل التبويبات والحملات */}
          {recentSelected.length > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12,
              background: 'color-mix(in srgb, var(--gold) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)',
              borderRadius: 8, padding: '8px 12px', marginBottom: 10, color: 'var(--gold)' }}>
              <AlertTriangle size={14}/> {recentSelected.length} من المختارين أُرسل لهم خلال آخر {recentDays} أيام
              <Btn size="sm" variant="ghost" onClick={excludeRecent}>استبعادهم</Btn>
            </div>
          )}

          {/* ⏰ جدولة بدل الإرسال الفوري — ينفّذها المشغّل الآلي كل 15 دقيقة */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12,
            border: '1px dashed var(--border2)', borderRadius: 9, padding: '8px 12px' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer', color: 'var(--text)' }}>
              <input type="checkbox" checked={schedOn} onChange={e => setSchedOn(e.target.checked)} style={{ accentColor: 'var(--accent)' }}/>
              <Clock size={13}/> جدولة الإرسال لوقت لاحق
            </label>
            {schedOn && (
              <input type="datetime-local" value={schedAt} onChange={e => setSchedAt(e.target.value)}
                style={{ fontSize: 12.5, padding: '5px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}/>
            )}
          </div>

          <div style={{ background: 'rgba(217,119,6,.07)', border: '1px solid rgba(217,119,6,.3)', borderRadius: 8, padding: '9px 12px', fontSize: 11.5, color: '#92400E', marginBottom: 14 }}>
            ⚠️ سيُرسَل القالب لـ{selectedValid.length} عميل مختار عبر واتساب. لا يمكن التراجع بعد الإرسال.
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
            <Btn variant="accent" onClick={doSend} disabled={sending || !selectedValid.length || !tpl || !campName.trim()}>
              {sending ? <><Spinner size={14}/> {progress ? `يُرسِل ${fmt(progress.done)}/${fmt(progress.total)}…` : 'جارٍ…'}</>
                : schedOn ? <><Clock size={14}/> جدولة ({fmt(selectedValid.length)})</>
                : <><Send size={14}/> إرسال ({fmt(selectedValid.length)})</>}
            </Btn>
            <Btn variant="ghost" onClick={onClose} disabled={sending}>إلغاء</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}
function ResultStat({ label, value, color }) {
  return (
    <div style={{ flex: 1, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 9, padding: '11px 14px', textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', color }}>{value}</div>
    </div>
  );
}
