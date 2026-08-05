// إرسال حملة واتساب عبر Hatif/Voxa — معاينة → تأكيد → نتائج.
// External action: nothing is sent until the operator presses «إرسال الآن».
// The API key lives only in the edge function; this UI never sees it.

import { useState, useEffect, useMemo, useRef } from 'react';
import { MessageCircle, ShieldCheck, Send, X, AlertTriangle, CheckCircle2, Clock, Plus, Minus } from 'lucide-react';
import { Modal, Btn, Spinner, toast } from './UI.jsx';
import { loadWhatsAppConfig, verifyWhatsAppKey, sendWhatsAppCampaign, loadWhatsAppCampaignStatus, saveTemplateVarMap, loadCampaignNames, loadCampaignPhones, loadCampaignRecipientContext, loadNoWhatsappSet, loadHatifTouchedPhones, loadWeakWhatsappSet, loadWhatsAppQuality, qualityTone } from '../lib/whatsappService.js';
import { scheduleCampaign } from '../lib/retargetingService.js';
import { useAuth } from '../lib/auth.jsx';
import { prepareWhatsAppAudienceRows, summarizeWhatsAppAudience, whatsappRecipientKey } from '../lib/whatsappAudience.js';

const fmt = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

// اسم حملة فريد افتراضياً: القاعدة + تاريخ اليوم، وإن تصادم يُضاف رقم (2)/(3)…
// حتى لا يُدمج القياس/الاستثناء مع حملة سابقة. المستخدم يبقى قادراً على تعديله.
function uniqueCampaignName(base, existing) {
  const b = (base || 'حملة').trim();
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  const set = new Set((existing || []).map(c => c.name));
  const first = `${b} — ${today}`;
  if (!set.has(first)) return first;
  for (let i = 2; i < 200; i++) { const c = `${b} — ${today} (${i})`; if (!set.has(c)) return c; }
  return `${b} — ${today} (${Date.now()})`;
}

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
  invoice_date: 'تاريخ الفاتورة',
  invoice_number: 'رقم الفاتورة',
  remaining:    'المبلغ المتبقي (غير المدفوع)',
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
export default function WhatsAppSendModal({ open, onClose, recipients = [], bucketLabel, onSent, lockedTemplate = null, salesAudience = false }) {
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
  const nameEdited = useRef(false);                        // هل عدّل المستخدم الاسم يدوياً (فلا نُعيد ضبطه)
  const [campaigns, setCampaigns] = useState([]);          // الحملات السابقة (اسم/عدد/آخر إرسال)
  const [exCamps, setExCamps]     = useState(() => new Set());  // أسماء الحملات المستثناة
  const [exPhones, setExPhones]   = useState(() => new Set());  // أرقامها (تُجلب عند الاختيار)
  const [exOpen, setExOpen]       = useState(false);
  // سياق واسع لكل مستلم من القاعدة (شحنات/محفظة/زوهو…) — حقول الصفحة تفوز عند التعارض
  const [ctx, setCtx]             = useState(() => new Map());
  // أرقام بلا واتساب — تُستبعَد آلياً من كل حملة (لا استثناء يدوي)
  const [noWa, setNoWa]          = useState(() => new Set());
  const [hatifTouched, setHatifTouched] = useState(() => new Map()); // يتواصل معهم الفريق في هاتف
  const [weak, setWeak] = useState(() => new Set());  // أرقام ضعيفة (لا تسليم قط) — تُستبعَد لحماية الرقم الآن
  const [qual, setQual] = useState([]);               // جودة القوالب (30ي) — تحذير عند اختيار قالب يخنقه ميتا
  // «رسالة لكل متجر»: افتراضياً OFF (يُدمَج تكرار الهاتف — الأأمن ضد الحظر). لمّا
  // يملك رقم عدة متاجر ويُفعَّل → كل متجر رسالة مستقلة ببياناته. المفتاح يتحوّل
  // من الهاتف إلى معرّف المتجر (r._rk) ليُميَّز متجران على نفس الرقم.
  const [perStore, setPerStore] = useState(false);
  const [protectionsReady, setProtectionsReady] = useState(false);
  const [protectionsError, setProtectionsError] = useState('');

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
    nameEdited.current = false;
    setCampName(uniqueCampaignName(bucketLabel, [])); setExCamps(new Set()); setExPhones(new Set()); setExOpen(false);
    setPerStore(false); setProtectionsReady(false); setProtectionsError('');
    // الكل افتراضياً — بمفاتيح _rk (نفس صيغة rows: معرّف المتجر أو الهاتف+الترتيب)
    setSelected(new Set(recipients
      .map((r, i) => (r.to && r.to.length >= 11) ? whatsappRecipientKey(r, i) : null)
      .filter(Boolean)));
    loadCampaignNames().then(list => {
      setCampaigns(list);
      // بعد معرفة الحملات السابقة: إن لم يعدّل المستخدم الاسم، اجعله فريداً فعلاً
      // (يضيف رقماً لو الاسم+تاريخ اليوم مُستخدَم) — فلا يُدمج القياس صامتاً.
      if (!nameEdited.current) setCampName(uniqueCampaignName(bucketLabel, list));
    }).catch(() => setCampaigns([]));
    setCtx(new Map());
    loadCampaignRecipientContext(recipients.map(r => r.to)).then(setCtx).catch(() => {});
    Promise.all([loadNoWhatsappSet(), loadHatifTouchedPhones(30), loadWeakWhatsappSet()])
      .then(([blocked, touched, weakPhones]) => {
        setNoWa(blocked); setHatifTouched(touched); setWeak(weakPhones);
        setProtectionsReady(true);
      })
      .catch((error) => {
        setProtectionsError(error?.message || 'تعذّر فحص قوائم الحماية');
      });
    loadWhatsAppConfig()
      .then(c => {
        setCfg(c);
        // إعادة إرسال للفاشلين → القالب مقفول على قالب الحملة الأصلي (ممنوع تغييره)
        const t = lockedTemplate || c.templateName || (c.templates || [])[0] || '';
        setTpl(t);
        setVarMap(defaultMapFor(t, c));
      })
      .catch(() => { setCfg({ templates: [], templateName: '', templateLanguage: 'ar' }); setTpl(''); setVarMap([{ src: 'legacy', text: '' }]); });
    loadWhatsAppCampaignStatus().then(setWaStatus).catch(() => {});
    loadWhatsAppQuality('template', 30).then(setQual).catch(() => {});
  }, [open]);

  // تغيير القالب → تحميل ربطه المحفوظ (أو الافتراضي)
  const pickTemplate = (t) => { setTpl(t); setVarMap(defaultMapFor(t, cfg)); };

  // أداء القالب المختار خلال 30 يوماً — يُعرَض **لحظة القرار** لا في تقرير
  // يُفتَح لاحقاً. تحذير فقط بلا منع: قرار الإطلاق للمستخدم، لكن لا يُطلق
  // وهو يجهل أن ميتا ترفض خُمس رسائل هذا القالب.
  const tplQuality = useMemo(() => qual.find(x => x.label === tpl) || null, [qual, tpl]);

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

  // كل مستلِم يحمل مفتاحاً فريداً ثابتاً (_rk): معرّف المتجر إن وُجد، وإلا
  // الهاتف+الترتيب. أساس اختيار «رسالة لكل متجر» (متجران على رقم واحد لهما
  // مفتاحان مختلفان). ثابت طوال فتح المودال (recipients ثابتة).
  const rows = useMemo(() => prepareWhatsAppAudienceRows(recipients), [recipients]);
  // كم رقماً يملك أكثر من متجر (لإظهار زر «رسالة لكل متجر» عند اللزوم فقط).
  const sharedPhones = useMemo(() => {
    const m = new Map();
    for (const r of rows) if (r.to && r.to.length >= 11) m.set(r.to, (m.get(r.to) || 0) + 1);
    return [...m.values()].filter(c => c > 1).length;
  }, [rows]);

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

  // استبعاد آلي للمدينين من حملات **المبيعات** (salesAudience فقط): رقم أي متجر
  // من متاجره محفظته سالبة لا يُخاطَب بعرض تسويقي — حادثة 2026-07-21: 23 متجراً
  // بمحافظ −74 ألف وصلتهم «ارجع اشحن معنا» بدل المطالبة (فحص الوكلاء).
  // ⚠️ يجب أن يبقى هذا الـhook فوق `if (!open) return null` — وضعه بعده كسر
  // قاعدة ترتيب الـhooks (React #310) لحظة فتح المودال (حادثة 2026-07-28).
  const debtorSet = useMemo(() => {
    const s = new Set();
    if (!salesAudience) return s;
    for (const [phone, stores] of ctx) {
      if ((stores || []).some(st => (st.wallet ?? 0) < -0.5)) s.add(phone);
    }
    return s;
  }, [ctx, salesAudience]);

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

  // الدمج: افتراضياً حسب الهاتف (رقم واحد = مستلِم واحد — الأأمن ضد الحظر، حادثة
  // 2026-07-21: رقم استلم 3 رسائل/37ث). عند «رسالة لكل متجر» → الدمج حسب معرّف
  // المتجر فيصبح كل متجر مستلِماً مستقلاً برسالته وبياناته. أول صف يفوز عند الدمج
  // بالهاتف (الأعلى شحناً — الصفحات ترتّب تنازلياً).
  const audience = summarizeWhatsAppAudience({
    rows, perStore, noWhatsapp: noWa, excludedPhones: exPhones,
    hatifTouched, weakPhones: weak, debtorPhones: debtorSet,
  });
  const validAll = audience.uniqueValidPhoneRows;
  const valid = audience.ready;
  const skipped = audience.counts.missingPhone;
  const dupSkipped = audience.counts.duplicatePhone;
  const noWaCount = audience.counts.noWhatsapp;
  const excludedCount = audience.counts.previousCampaign;
  const hatifTouchedCount = audience.counts.hatifTouched;
  const weakCount = audience.counts.weakNumber;
  const debtorCount = audience.counts.debtor;
  const selectedValid = valid.filter(r => selected.has(r._rk));
  // مفاتيح كل المستلِمين الصالحين في وضعٍ ما (لإعادة الاختيار عند تبديل الزر)
  const allKeysFor = (mode) => {
    const seen = new Set(); const out = [];
    for (const r of rows) {
      if (!r.to || r.to.length < 11) continue;
      const dk = mode ? r._rk : r.to;
      if (seen.has(dk)) continue;
      seen.add(dk); out.push(r._rk);
    }
    return out;
  };
  // لا حدّ للعدد: الفوري يُقسَّم دفعات 60 متتالية — القياس الفعلي ≈ ثانية/رسالة
  // (إرسال هاتف + التسجيل الفوري)، فدفعة 60 ≈ دقيقة، بأمان تحت مهلة الدالة 150ث.
  // (120 سابقاً لامست المهلة وقُتلت 504 على حملة 290). الكبير الأفضل جدولته.
  const SEND_CHUNK = 60;
  const lastSentOf = (to) => waStatus.get(to)?.lastSentAt || null;
  // «آخر رسالة» تعني رسالة **وصلت** فعلاً. المحاولة الفاشلة لا تُحتسب —
  // كانت تُعرض «آخر رسالة: اليوم» لمن لم تصله رسالة قط (بلاغ 2026-07-28).
  const contactStateOf = (to) => {
    const s = waStatus.get(to);
    if (!s) return { text: 'لم تُراسَل من قبل', tone: 'var(--muted2)' };
    if (s.lastDeliveredAt) {
      const t = daysAgoTxt(s.lastDeliveredAt);
      return { text: `آخر رسالة وصلته: ${t}`, tone: 'var(--gold)' };
    }
    if (s.lastAttemptFailed || s.lastSentAt) {
      const t = daysAgoTxt(s.lastSentAt);
      return { text: `لم تصله رسالة قط · آخر محاولة فشلت${t ? ` (${t})` : ''}`, tone: 'var(--red)' };
    }
    return { text: 'لم تُراسَل من قبل', tone: 'var(--muted2)' };
  };
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
    for (const r of recentSelected) n.delete(r._rk);
    return n;
  });

  const toggle = (k) => setSelected(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const allOn  = () => setSelected(new Set(valid.map(r => r._rk)));
  const allOff = () => setSelected(new Set());
  // تبديل «رسالة لكل متجر» — يغيّر الدمج فيُعاد اختيار الكل وفق الوضع الجديد
  const togglePerStore = (m) => { setPerStore(m); setSelected(new Set(allKeysFor(m))); };

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
    if (!protectionsReady) { toast('انتظر اكتمال فحص أهلية المستلمين', 'warn'); return; }
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
        recipients: selectedValid.map(v => ({
          to: v.to, vars: resolveVarsFor(v), name: v.name, amount: v.amount,
          idempotency_ref: v._rk,
        })),
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
    if (!protectionsReady) { toast('انتظر اكتمال فحص أهلية المستلمين', 'warn'); return; }
    if (schedOn) return doSchedule();
    if (!campName.trim()) { toast('اكتب اسماً للحملة أولاً', 'warn'); return; }
    if (!tpl) { toast('اختر قالباً — أو أضفه من «إعدادات واتساب»', 'warn'); return; }
    if (!selectedValid.length) { toast('اختر مستلِماً واحداً على الأقل', 'warn'); return; }
    setSending(true);
    const items = selectedValid.map(v => ({
      to: v.to, vars: resolveVarsFor(v), name: v.name, amount: v.amount,
      idempotency_ref: v._rk,
    }));
    const agg = { ok: true, total: items.length, sent: 0, failed: 0, skipped: 0, results: [] };
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
        agg.sent += r.sent || 0; agg.failed += r.failed || 0; agg.skipped += r.skipped || 0;
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
    else toast(`تمت المعالجة — ${agg.sent} أُرسلت · ${agg.skipped} لم تُكرّر · ${agg.failed} فشلت`, (agg.failed ? 'warn' : 'success'));
    onSent?.(agg);
  };

  return (
    <Modal title="📲 إرسال حملة واتساب" onClose={onClose} width={560}>
      {!cfg ? <div style={{ padding: 40, textAlign: 'center' }}><Spinner/></div> : results ? (
        // ── Results view ──
        <div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
            <ResultStat label="نجحت" value={results.sent || 0} color="var(--green2)"/>
            {!!results.skipped && <ResultStat label="لم تُكرّر" value={results.skipped} color="var(--gold)"/>}
            <ResultStat label="فشلت" value={results.failed || 0} color={results.failed ? 'var(--red)' : '#6B7280'}/>
            <ResultStat label="الإجمالي" value={results.total || valid.length} color="var(--brand)"/>
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
          {(results.sent > 0 || results.skipped > 0) && !results.failed && (
            <div style={{ fontSize: 12, color: 'var(--green2)', background: 'color-mix(in srgb, var(--green) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--green) 28%, transparent)', borderRadius: 8, padding: '9px 12px' }}>
              {results.skipped > 0
                ? `🛡️ أُرسلت ${results.sent || 0} رسالة جديدة، ومنع النظام تكرار ${results.skipped} رسالة سبق تنفيذها أو ما زالت نتيجتها غير محسومة.`
                : '✅ أُرسلت كل الرسائل بنجاح — تابع حالتها (وصلت/قُرئت/ردّ) في «سجل الحملات».'}
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
            <input value={campName} onChange={e => { nameEdited.current = true; setCampName(e.target.value); }} placeholder="مثال: تحصيل متأخرين يوليو"
              style={{ flex: 1, fontSize: 12.5, padding: '7px 11px', borderRadius: 8,
                border: `1px solid ${campName.trim() ? 'var(--border)' : 'var(--red)'}`, background: 'var(--bg)', color: 'var(--text)' }}/>
          </div>
          {/* تحذير اسم مكرّر — يخلط القياس (حملتان تحت اسم واحد). استخدم اسماً فريداً. */}
          {campName.trim() && campaigns.some(c => c.name === campName.trim()) && (
            <div style={{ fontSize: 11, color: 'var(--gold)', marginTop: -4, marginBottom: 8 }}>
              ⚠️ اسم مُستخدَم سابقاً — سيُدمج القياس مع الحملة القديمة. أضِف تاريخاً لاسم فريد (مثال: «{campName.trim()} — {new Date().toLocaleDateString('en-CA')}»).
            </div>
          )}

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
            {lockedTemplate ? (
              // إعادة إرسال للفاشلين → قالب الحملة الأصلي مقفول (نفس الرسالة، ممنوع تغييره)
              <span style={{ fontSize: 12.5, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '5px 10px', borderRadius: 7, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                🔒 {tpl || lockedTemplate}
                <span style={{ fontSize: 10.5, color: 'var(--muted2)', fontWeight: 400, marginInlineStart: 6, fontFamily: 'var(--font-sans)' }}>قالب الحملة الأصلي</span>
              </span>
            ) : (cfg.templates || []).length > 0 ? (
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

          {/* أداء القالب المختار — لحظة القرار لا بعده */}
          {tplQuality && tplQuality.sent >= 30 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12,
              fontSize: 12, borderRadius: 9, padding: '8px 12px',
              color: 'var(--text2)',
              background: `color-mix(in srgb, ${qualityTone(tplQuality.verdict)} 8%, transparent)`,
              border: `1px solid color-mix(in srgb, ${qualityTone(tplQuality.verdict)} 30%, transparent)`,
            }}>
              <span style={{ fontWeight: 700, color: qualityTone(tplQuality.verdict) }}>{tplQuality.verdict}</span>
              <span style={{ color: 'var(--muted)' }}>
                آخر 30 يوماً · {tplQuality.sent.toLocaleString('en-US')} رسالة ·
                وصلت <b style={{ fontFamily: 'var(--font-mono)' }}>{tplQuality.deliveryRate}%</b> ·
                ردّوا <b style={{ fontFamily: 'var(--font-mono)' }}>{tplQuality.replyRate ?? 0}%</b>
                {tplQuality.ecosystemRate > 0 && <> · خنق ميتا <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--red)' }}>{tplQuality.ecosystemRate}%</b></>}
              </span>
              {tplQuality.ecosystemRate >= 10 && (
                <span style={{ fontSize: 11, color: 'var(--muted2)', width: '100%' }}>
                  ميتا ترفض جزءاً من هذا القالب للحفاظ على جودة المنظومة — الاستمرار يخفّض تصنيف رقمك وحدّك اليومي. جرّب شريحة أدقّ أو صياغة أقل تسويقية.
                </span>
              )}
            </div>
          )}

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

          {/* رقم واحد يملك عدة متاجر — زر «رسالة لكل متجر» (افتراضياً OFF = رسالة/رقم) */}
          {sharedPhones > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12,
              background: 'color-mix(in srgb, var(--accent) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 28%, var(--border))',
              borderRadius: 9, padding: '8px 12px', cursor: 'pointer' }}>
              <input type="checkbox" checked={perStore} onChange={e => togglePerStore(e.target.checked)} style={{ accentColor: 'var(--accent)' }}/>
              <span style={{ flex: 1 }}>
                <b>رسالة لكل متجر</b> — {sharedPhones} رقم يملك عدة متاجر.
                <span style={{ color: 'var(--muted)' }}> {perStore
                  ? ' كل متجر يستقبل رسالة ببياناته (الرقم قد يصله عدة رسائل).'
                  : ' الآن: رسالة واحدة لكل رقم (يُدمَج التكرار). فعّله لإرسال رسالة لكل متجر.'}</span>
              </span>
            </label>
          )}

          {/* معادلة الجمهور: لا يتغير الرقم بين الفلتر والإرسال بلا تفسير. */}
          <div role="status" style={{ marginBottom: 10, border: '1px solid var(--border)', borderRadius: 10,
            padding: 10, background: 'var(--surface2)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
              <AudienceStat label="نتيجة الفلتر" value={audience.source}/>
              <AudienceStat label="جاهز للإرسال" value={protectionsReady ? valid.length : '…'} color="var(--green)"/>
              <AudienceStat label="مستبعد تلقائياً" value={protectionsReady ? audience.excluded : '…'} color={audience.excluded ? 'var(--gold)' : 'var(--muted)'}/>
            </div>
            {!protectionsReady && !protectionsError && (
              <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--muted)' }}>يفحص النظام الحظر وتكرار الهاتف وجودة الأرقام قبل السماح بالإرسال…</div>
            )}
            {protectionsError && (
              <div role="alert" style={{ marginTop: 8, fontSize: 11.5, color: 'var(--red)' }}>
                تعذّر فحص قوائم الحماية: {protectionsError}. الإرسال متوقف حتى إعادة فتح النافذة والمحاولة مجدداً.
              </div>
            )}
            {protectionsReady && audience.excluded > 0 && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)', lineHeight: 1.7 }}>
                أسباب الاستبعاد:
                {skipped > 0 && ` بلا هاتف ${skipped} ·`}
                {dupSkipped > 0 && ` هاتف مكرر ${dupSkipped} ·`}
                {noWaCount > 0 && ` بلا واتساب/محظور ${noWaCount} ·`}
                {hatifTouchedCount > 0 && ` يتابعهم فريق هاتف ${hatifTouchedCount} ·`}
                {weakCount > 0 && ` رقم ضعيف ${weakCount} ·`}
                {debtorCount > 0 && ` موقوف مالياً ${debtorCount} ·`}
                {excludedCount > 0 && ` من حملات مستثناة ${excludedCount} ·`}
                <span> المجموع {audience.excluded}</span>
              </div>
            )}
          </div>

          {/* اختيار المستلِمين */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12.5, flexWrap: 'wrap' }}>
            <b>المستلِمون: {selectedValid.length} / {valid.length}</b>
            <Btn size="sm" variant="ghost" onClick={allOn} disabled={!protectionsReady}>تحديد الكل</Btn>
            <Btn size="sm" variant="ghost" onClick={allOff}>إلغاء الكل</Btn>
          </div>
          <div className="m-flow" style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 12 }}>
            {valid.slice(0, 400).map((r, i) => {
              const st = contactStateOf(r.to);
              return (
                <label key={r._rk} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                  borderTop: i ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}>
                  <input type="checkbox" checked={selected.has(r._rk)} onChange={() => toggle(r._rk)}/>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || r.to}</span>
                    <span style={{ display: 'block', fontSize: 10.5, color: st.tone }}>
                      {st.text}
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
            <Btn variant="accent" onClick={doSend} disabled={sending || !protectionsReady || !selectedValid.length || !tpl || !campName.trim()}>
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

function AudienceStat({ label, value, color = 'var(--text)' }) {
  return (
    <div style={{ minWidth: 0, border: '1px solid var(--border)', borderRadius: 8, padding: '8px 6px', textAlign: 'center', background: 'var(--bg)' }}>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-mono)', color }}>{value}</div>
    </div>
  );
}
