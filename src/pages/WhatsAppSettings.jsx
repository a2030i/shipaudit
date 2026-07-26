// إعدادات واتساب (Hatif · هاتف/Voxa) — مكان ثابت لضبط القالب والقناة والتحقّق،
// بدل تكرار الإعداد داخل مودال الإرسال. يُخزَّن في app_settings key='whatsapp_config'
// ويُستخدَم في حملات التحصيل (/customer-money) وإعادة الاستهداف. اللغة ثابتة ar.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { MessageCircle, RefreshCw, ShieldCheck, CheckCircle2, X, Save, Plus, Trash2 } from 'lucide-react';
import IvrCampaignModal from '../components/IvrCampaignModal.jsx';
import { Card, Btn, Spinner, Empty, PageHeader, Input, toast } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import IvrTab from '../components/IvrSettingsTab.jsx';
import { loadWhatsAppConfig, saveWhatsAppConfig, verifyWhatsAppKey,
  loadZatcaAlertConfig, saveZatcaAlertConfig, previewZatcaAlert, sendZatcaAlertNow,
  loadWhatsAppLog, loadWhatsAppCampaignReport, loadCampaignFailures, loadNoWhatsappList,
  loadBlocklist, addToBlocklist, removeFromBlocklist, loadWhatsAppDeliveryHealth, loadHatifUsers,
  loadHatifAgentActivity, loadHatifCallStats, loadHatifCalls, loadHatifCallProblems, loadHatifProblemCalls, runHatifTagSync, loadTagSyncStatus, loadHatifTags } from '../lib/whatsappService.js';
import { CampaignLogTable } from '../components/WhatsAppCampaignLog.jsx';
import WhatsAppSendModal from '../components/WhatsAppSendModal.jsx';
import * as XLSX from 'xlsx';
import { rtl } from '../lib/xlsxRtl.js';
import { persistAndDownloadExport } from '../lib/internalExportsService.js';

export default function WhatsAppSettings({ isActive = true }) {
  const { can, isAdmin } = useAuth();
  const [cfg, setCfg] = useState(null);
  const [newTpl, setNewTpl] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(null);
  const [zatca, setZatca] = useState(null);        // إعداد تنبيه زاتكا المسائي
  const [zBusy, setZBusy] = useState(false);
  const [zPrev, setZPrev] = useState(null);
  const [tab, setTab] = useState('settings');      // settings | campaigns

  const [hatifUsers, setHatifUsers] = useState([]);   // موظفو هاتف (الفريق يردّ هناك)
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, z, hu] = await Promise.all([loadWhatsAppConfig(), loadZatcaAlertConfig().catch(() => null), loadHatifUsers().catch(() => [])]);
      setCfg(c); setZatca(z || { enabled: false, phone: '', templateName: '' }); setHatifUsers(hu || []);
    } catch (e) { toast(e.message, 'error'); }
    setLoading(false);
  }, []);
  useEffect(() => { if (isActive) load(); }, [isActive, load]);

  if (!can('whatsapp.configure') && !can('whatsapp.view_log')) return <div style={{ padding: 40 }}><Empty icon="🔒" title="لا صلاحية"/></div>;

  const templates = Array.isArray(cfg?.templates) ? cfg.templates : [];
  const addTpl = () => {
    const t = newTpl.trim();
    if (!t) return;
    if (templates.includes(t)) { toast('القالب مضاف مسبقاً', 'warn'); return; }
    setCfg({ ...cfg, templates: [...templates, t], templateName: cfg.templateName || t });
    setNewTpl('');
  };
  const removeTpl = (t) => {
    const next = templates.filter(x => x !== t);
    setCfg({ ...cfg, templates: next, templateName: cfg.templateName === t ? (next[0] || '') : cfg.templateName });
  };

  const save = async () => {
    setSaving(true);
    try { await saveWhatsAppConfig({ ...cfg, templateLanguage: 'ar' }); toast('تم حفظ الإعدادات', 'success'); }
    catch (e) { toast(`فشل الحفظ: ${e.message}`, 'error'); }
    setSaving(false);
  };
  const verify = async () => {
    setVerifying(true); setVerified(null);
    const r = await verifyWhatsAppKey();
    setVerified(!!r.ok);
    toast(r.ok ? 'الاتصال بـHatif يعمل ✓' : `فشل التحقّق: ${r.error || ''}`, r.ok ? 'success' : 'error');
    setVerifying(false);
  };

  const zSave = async () => {
    setZBusy(true);
    try { await saveZatcaAlertConfig(zatca); toast('تم حفظ تنبيه زاتكا', 'success'); }
    catch (e) { toast(`فشل الحفظ: ${e.message}`, 'error'); }
    setZBusy(false);
  };
  const zPreviewRun = async () => {
    setZBusy(true); setZPrev(null);
    const r = await previewZatcaAlert();
    setZPrev(r);
    if (!r?.ok) toast(`تعذّرت المعاينة: ${r?.error || ''}`, 'error');
    setZBusy(false);
  };
  const zSendTest = async () => {
    setZBusy(true);
    const r = await sendZatcaAlertNow();
    toast(r?.ok ? (r.sent ? 'أُرسل التنبيه التجريبي ✓' : `تخطّي: ${r.skipped || ''}`) : `فشل: ${r?.error || ''}`, r?.ok ? 'success' : 'error');
    setZBusy(false);
  };

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: (tab === 'campaigns' || tab === 'ivr') ? 1180 : 960, margin: '0 auto' }}>
      <PageHeader icon={<MessageCircle size={22}/>} iconColor="#22C55E"
        title="منصة هاتف"
        subtitle="الربط مع هاتف (Voxa) — قوالب واتساب + المكالمات الآلية + التاقات + جهات الاتصال"
        actions={<Btn size="sm" variant="ghost" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/></Btn>}
      />

      {/* مبدّل: الإعدادات / سجل الحملات */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[['settings', '⚙️ الإعدادات'], ['campaigns', '📋 سجل الحملات'], ['ivr', '📞 المكالمات الآلية'], ['agents', '👥 أداء الفريق'], ['problems', '🧩 تحليل المكالمات']].map(([v, lbl]) => (
          <button key={v} onClick={() => setTab(v)} style={{
            padding: '8px 16px', borderRadius: 9, cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
            border: `1.5px solid ${tab === v ? '#22C55E' : 'var(--border)'}`,
            background: tab === v ? 'color-mix(in srgb, #22C55E 12%, transparent)' : 'transparent', color: 'var(--text)',
          }}>{lbl}</button>
        ))}
      </div>

      {tab === 'ivr' ? <IvrTab/> :
      tab === 'problems' ? <CallProblemsTab/> :
      tab === 'agents' ? <AgentActivityTab/> :
      tab === 'campaigns' ? <CampaignsTab/> :
      !cfg ? <div style={{ padding: 40, textAlign: 'center' }}><Spinner/></div> : (
        <Card style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px', lineHeight: 1.7 }}>
            📡 المزوّد: <b style={{ color: 'var(--text)' }}>Hatif · هاتف (Voxa)</b> · اللغة: <b>ar</b> (ثابتة) · الأسرار
            (<code>client_id</code>/<code>secret</code>) في أسرار Supabase — لا تلمس المتصفّح.
            <br/>🔌 <b>القناة تُجلَب آلياً</b> من Hatif (لا حاجة لإدخال معرّفها). لتثبيت قناة بعينها ضَع <code>HATIF_CHANNEL_ID</code> في الأسرار.
          </div>

          {/* قائمة القوالب المعتمدة — تُختار إحداها عند إطلاق الحملة */}
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>القوالب المعتمدة</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 9 }}>
              <Input value={newTpl} onChange={e => setNewTpl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTpl(); } }}
                placeholder="اسم القالب كما في هاتف (حسّاس لحالة الأحرف)" style={{ flex: 1 }}/>
              <Btn variant="ghost" icon={<Plus size={14}/>} onClick={addTpl}>إضافة</Btn>
            </div>
            {templates.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 2px' }}>لا قوالب بعد — أضف اسم قالب واحداً على الأقل.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 8 }}>
                {templates.map(t => (
                  <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 160, cursor: 'pointer', fontSize: 12.5 }}>
                      <input type="radio" name="defaultTpl" checked={cfg.templateName === t} onChange={() => setCfg({ ...cfg, templateName: t })}/>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{t}</span>
                      {cfg.templateName === t && <span style={{ fontSize: 10.5, color: 'var(--green2)' }}>افتراضي</span>}
                    </label>
                    {/* المسؤول عن ردود هذا القالب في هاتف — تُسند إليه المحادثة آلياً عند الرد */}
                    <select value={cfg.templateAgents?.[t] || ''}
                      onChange={e => setCfg({ ...cfg, templateAgents: { ...(cfg.templateAgents || {}), [t]: e.target.value || undefined } })}
                      style={{ fontSize: 11.5, padding: '4px 8px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', minWidth: 160 }}
                      title="موظف هاتف المسؤول عن ردود هذا القالب">
                      <option value="">↩️ المسؤول في هاتف: —</option>
                      {hatifUsers.map(u => <option key={u.userId} value={u.userId}>{u.name}{u.email ? ` · ${u.email}` : ''}</option>)}
                    </select>
                    <Btn size="sm" variant="ghost" title="حذف" onClick={() => removeTpl(t)}><Trash2 size={13}/></Btn>
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>الافتراضي (⦿) هو المُختار مبدئياً عند فتح مودال الإرسال — ويمكن تبديله لحظة الإطلاق.</div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Btn variant="accent" icon={<Save size={14}/>} onClick={save} disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ'}</Btn>
            <Btn variant="ghost" icon={<ShieldCheck size={14}/>} onClick={verify} disabled={verifying}>{verifying ? 'جارٍ التحقّق…' : 'تحقّق من الاتصال'}</Btn>
            {verified === true && <span style={{ color: 'var(--green2)', fontSize: 12, display: 'inline-flex', gap: 4, alignItems: 'center' }}><CheckCircle2 size={13}/> يعمل</span>}
            {verified === false && <span style={{ color: 'var(--red)', fontSize: 12, display: 'inline-flex', gap: 4, alignItems: 'center' }}><X size={13}/> فشل — راجع الأسرار</span>}
          </div>

          <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.8, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            • القالب يُستخدَم في <b>حملات التحصيل</b> (فلوسي عند العملاء) و<b>إعادة الاستهداف</b>.<br/>
            • رتّب متغيّرات القالب في هاتف بنفس ترتيب رسالتنا: <code>{'{{1}}'}</code> الاسم · <code>{'{{2}}'}</code> المبلغ · <code>{'{{3}}'}</code> عدد الفواتير.<br/>
            • اسم القالب <b>حسّاس لحالة الأحرف</b> ويجب أن يطابق المعتمد في لوحة هاتف تماماً.<br/>
            • ملخّص الصباح له إعداده الخاص (زر 🌅 في فلوسي عند العملاء).
          </div>
        </Card>
      )}

      {/* ── إسناد المحادثات تلقائياً في هاتف — القالب يحدّد المسؤول (الفريق في هاتف) ── */}
      {tab === 'settings' && can('whatsapp.configure') && (
        <Card style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>👥 إسناد ردود القوالب في هاتف</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
            عند ردّ العميل على حملة، النظام <b>يُسند المحادثة في هاتف لموظف هاتف المسؤول عن القالب</b> — تظهر عنده مباشرة.
            اختر المسؤول لكل قالب من القائمة أعلاه (منسدلة «المسؤول في هاتف»). <b>لا يحتاج الموظف حساباً في نظامنا</b> — يكفي وجوده في هاتف.
          </div>
          <div style={{ fontSize: 11.5, color: hatifUsers.length ? 'var(--green2)' : 'var(--gold)' }}>
            {hatifUsers.length ? `✓ ${hatifUsers.length} موظف هاتف متاح للإسناد` : '⚠️ لم يتم جلب موظفي هاتف — تأكّد من أسرار Hatif، ثم أعد فتح الصفحة.'}
          </div>
        </Card>
      )}

      {/* ── متابعة غير المتجاوبين تلقائياً (drip §1.37) — ينفّذها campaign-runner كل 15 دقيقة ── */}
      {tab === 'settings' && cfg && (
        <Card style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>🔁 متابعة غير المتجاوبين تلقائياً</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
            مَن استلم حملة <b>ولم يردّ خلال N يوم</b> يُرسَل له قالب المتابعة تلقائياً — <b>مرة واحدة فقط</b> لكل حملة
            (لا يلاحق مَن ردّ، ولا مَن مضى على حملته أكثر من 30 يوماً). يعمل عبر المشغّل الآلي كل 15 دقيقة.
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!cfg.drip?.enabled}
              onChange={e => setCfg({ ...cfg, drip: { ...(cfg.drip || {}), enabled: e.target.checked } })}/>
            تفعيل المتابعة التلقائية
          </label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>قالب المتابعة</div>
              {(cfg.templates || []).length ? (
                <select value={cfg.drip?.template || ''}
                  onChange={e => setCfg({ ...cfg, drip: { ...(cfg.drip || {}), template: e.target.value } })}
                  style={{ fontSize: 12.5, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-mono)', width: '100%' }}>
                  <option value="">— اختر قالباً —</option>
                  {(cfg.templates || []).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              ) : <div style={{ fontSize: 11.5, color: 'var(--red)' }}>أضف قالباً في الأعلى أولاً</div>}
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>بعد كم يوم بلا رد؟</div>
              <input type="number" min={1} max={14} value={cfg.drip?.afterDays ?? 3}
                onChange={e => setCfg({ ...cfg, drip: { ...(cfg.drip || {}), afterDays: Number(e.target.value) || 3 } })}
                style={{ width: 90, fontSize: 12.5, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}/>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            متغيّر قالب المتابعة: <code>{'{{1}}'}</code> اسم العميل فقط — صمّمه في هاتف كتذكير لطيف عام.
            احفظ بزر «حفظ» أعلى الصفحة (نفس إعدادات القوالب).
          </div>
        </Card>
      )}

      {/* ── نظام التاقات المؤتمت — يوسم محادثات هاتف بحالة العميل تلقائياً ── */}
      {tab === 'settings' && isAdmin && <TagSystemCard/>}

      {/* ── تنبيه زاتكا المسائي — واتساب 9م بتوقيت السعودية بالفواتير التي لم تُرسَل ── */}
      {tab === 'settings' && zatca && (
        <Card style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>🧾 تنبيه زاتكا المسائي</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
            رسالة واتساب يومية <b>9 مساءً</b> بتوقيت السعودية بعدد الفواتير التي <b>لم تُرسَل لزاتكا اليوم</b> —
            لتُرسلها من زوهو قبل منتصف الليل. لا تُرسَل إن لم توجد فواتير معلّقة اليوم.
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!zatca.enabled} onChange={e => setZatca({ ...zatca, enabled: e.target.checked })}/>
            تفعيل التنبيه
          </label>
          <Input label="رقم المستلِم (المسؤول)" value={zatca.phone || ''}
            onChange={e => setZatca({ ...zatca, phone: e.target.value })} placeholder="05XXXXXXXX"/>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>قالب التنبيه</div>
            {(cfg?.templates || []).length ? (
              <select value={zatca.templateName || ''} onChange={e => setZatca({ ...zatca, templateName: e.target.value })}
                style={{ fontSize: 12.5, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-mono)', width: '100%' }}>
                <option value="">— اختر قالباً —</option>
                {(cfg.templates || []).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            ) : <div style={{ fontSize: 11.5, color: 'var(--red)' }}>أضف قالباً في الأعلى أولاً</div>}
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
              متغيّرات هذا القالب: <code>{'{{1}}'}</code> عدد فواتير اليوم · <code>{'{{2}}'}</code> إجماليها ر.س · <code>{'{{3}}'}</code> عدد المتأخرة سابقاً.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Btn variant="accent" icon={<Save size={14}/>} onClick={zSave} disabled={zBusy}>حفظ</Btn>
            <Btn variant="ghost" onClick={zPreviewRun} disabled={zBusy}>معاينة الأرقام</Btn>
            <Btn variant="ghost" onClick={zSendTest} disabled={zBusy}>إرسال تجريبي الآن</Btn>
          </div>
          {zPrev?.ok && (
            <div style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px' }}>
              اليوم: <b style={{ color: 'var(--text)' }}>{zPrev.todayCount}</b> فاتورة ({Number(zPrev.todayTotal || 0).toLocaleString('en-US')} ر.س) ·
              متأخرة سابقاً: <b style={{ color: 'var(--red)' }}>{zPrev.overdueCount}</b>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// تاب تحليل المكالمات — تصنيف آلي لمشاكل العملاء من نصوص المكالمات + اتجاه + تنقيب.
const PROBLEM_META = {
  price:          { icon: '💰', label: 'السعر مرتفع مقابل المنافسين', action: 'راجع باقة أسعار تنافسية / أسعار خاصة للحجم', color: '#EF4444' },
  returns:        { icon: '↩️', label: 'لبس ميزة الإرجاع المجاني', action: 'وضّح تغطية الإرجاع المجاني في القالب والمكالمة', color: '#F59E0B' },
  delivery:       { icon: '🚚', label: 'تأخّر التوصيل', action: 'تابع الشحنات المتأخرة وصعّد للناقل', color: '#EF4444' },
  lost:           { icon: '📦', label: 'شحنات مفقودة', action: 'افتح تذكرة دعم وتابع مع الناقل', color: '#EF4444' },
  support:        { icon: '🎧', label: 'صعوبة خدمة العملاء / بطء الرد', action: 'حسّن زمن الرد ومتابعة الطلبات', color: '#F59E0B' },
  billing:        { icon: '🧾', label: 'الفواتير / الفوترة', action: 'راجع دقّة الفواتير ووضوحها', color: '#F59E0B' },
  carriers:       { icon: '🚛', label: 'نقص خيارات الناقلين / السرعة', action: 'فعّل ناقلين إضافيين (خاصة جدة)', color: '#0EA5E9' },
  closed:         { icon: '🔒', label: 'إغلاق النشاط التجاري', action: 'ليس خللاً تقنياً — نظّف القائمة من المغلقين', color: 'var(--muted)' },
  cr_requirement: { icon: '📋', label: 'اشتراط السجل التجاري يطرد الأفراد', action: 'ادرس باقة أفراد بلا سجل تجاري', color: '#8B5CF6' },
};
function CallProblemsTab() {
  const [days, setDays] = useState(60);
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);        // الفئة المفتوحة
  const [calls, setCalls] = useState(null);
  const [openCall, setOpenCall] = useState(null);
  const fmtWhen = (iso) => { try { return new Date(iso).toLocaleDateString('ar-SA', { dateStyle: 'medium' }); } catch { return String(iso).slice(0, 10); } };
  const sentLabel = (v) => { const n = Number(v); if (!n) return null; return n >= 3 ? '😐' : '😞'; };

  useEffect(() => { setRows(null); loadHatifCallProblems(days).then(setRows).catch(() => setRows([])); setOpen(null); }, [days]);
  const drill = (cat) => {
    if (open === cat) { setOpen(null); return; }
    setOpen(cat); setCalls(null); setOpenCall(null);
    loadHatifProblemCalls(cat, days).then(setCalls).catch(() => setCalls([]));
  };

  return (
    <Card style={{ padding: 18, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800 }}>🧩 تحليل المكالمات — أكثر المشاكل</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>تصنيف آلي من نصوص المكالمات المحلَّلة. انقر فئة لسماع نماذجها.</div>
        </div>
        <select value={days} onChange={e => setDays(Number(e.target.value))} style={{ padding: '7px 10px', borderRadius: 8, fontSize: 12.5 }}>
          <option value={30}>آخر 30 يوماً</option>
          <option value={60}>آخر 60 يوماً</option>
          <option value={90}>آخر 90 يوماً</option>
        </select>
      </div>

      {rows == null ? <div style={{ padding: 30, textAlign: 'center' }}><Spinner/></div>
        : !rows.length ? <Empty icon="🧩" title="لا مكالمات محلَّلة بعد" sub="تظهر المشاكل تلقائياً كلما وصلت مكالمات بتحليل AI."/>
        : rows.map(r => {
          const m = PROBLEM_META[r.category] || { icon: '•', label: r.category, action: '', color: 'var(--muted)' };
          const trend = Number(r.calls) - Number(r.calls_prev);
          const isOpen = open === r.category;
          return (
            <div key={r.category} style={{ border: `1px solid ${isOpen ? m.color : 'var(--border)'}`, borderRadius: 10, overflow: 'hidden' }}>
              <div onClick={() => drill(r.category)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 18 }}>{m.icon}</span>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: m.color }}>{m.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{m.action}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 18 }}>{r.calls}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted2)' }}>مكالمة</div>
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: trend > 0 ? 'var(--red)' : trend < 0 ? 'var(--green)' : 'var(--muted)' }}>
                  {trend > 0 ? `▲ +${trend}` : trend < 0 ? `▼ ${trend}` : '—'}
                  <span style={{ fontSize: 9.5, color: 'var(--muted2)', fontWeight: 400 }}> مقابل الفترة السابقة</span>
                </span>
                <span style={{ color: 'var(--muted2)' }}>{isOpen ? '▲' : '▼'}</span>
              </div>
              {isOpen && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '8px 12px', display: 'grid', gap: 6 }}>
                  {calls == null ? <div style={{ padding: 16, textAlign: 'center' }}><Spinner/></div>
                    : !calls.length ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>لا نماذج.</div>
                    : calls.map(c => {
                      const co = openCall === c.id;
                      const sum = c.ai_summary?.summary;
                      return (
                        <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                          <div onClick={() => setOpenCall(co ? null : c.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px', cursor: 'pointer', fontSize: 12 }}>
                            <span style={{ color: 'var(--muted)' }}>{fmtWhen(c.creation_time)}</span>
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{Math.round((c.talk_seconds || 0) / 60)}د</span>
                            {sentLabel(c.sentiment) && <span>{sentLabel(c.sentiment)}</span>}
                            {c.recording_url && <span style={{ color: 'var(--accent)', fontSize: 10.5 }}>🎙</span>}
                            <span style={{ marginInlineStart: 'auto', color: 'var(--muted2)' }}>{co ? '▲' : '▼'}</span>
                          </div>
                          {co && (
                            <div style={{ borderTop: '1px solid var(--border)', padding: '6px 10px 10px', display: 'grid', gap: 6, fontSize: 12 }}>
                              {c.recording_url && <audio controls preload="none" src={c.recording_url} style={{ width: '100%', height: 32 }}/>}
                              {Array.isArray(sum) && <ul style={{ margin: 0, paddingInlineStart: 16, lineHeight: 1.7 }}>{sum.map((s, i) => <li key={i}>{s}</li>)}</ul>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          );
        })}
      <div style={{ fontSize: 10.5, color: 'var(--muted2)', lineHeight: 1.7, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        التصنيف آلي بالكلمات المفتاحية من ملخّص كل مكالمة (يستبعد قوائم IVR الترحيبية). الاتجاه = آخر {days} يوماً مقابل الفترة السابقة مثلها.
      </div>
    </Card>
  );
}

// تاب أداء الفريق — إسناد ونشاط الموظفين من أحداث هاتف (hatif_events).
// يتغذّى من webhook مساحة العمل (AssignedUserIdChanged…) — يمتلئ مع كل محادثة يتولّاها موظف.
function AgentActivityTab() {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState(null);
  const [calls, setCalls] = useState(null);       // إحصاءات المكالمات الحقيقية
  const [recent, setRecent] = useState(null);     // آخر المكالمات (تسجيل + ملخّص)
  const [agentFilter, setAgentFilter] = useState(null); // فلتر بموظف (user_id)
  const [openCall, setOpenCall] = useState(null); // مكالمة مفتوحة (ملخّص)
  const [users, setUsers] = useState([]);

  useEffect(() => { loadHatifAgentActivity(days).then(setRows).catch(() => setRows([])); }, [days]);
  useEffect(() => { loadHatifCallStats(days).then(setCalls).catch(() => setCalls([])); }, [days]);
  useEffect(() => { setRecent(null); loadHatifCalls({ days, userId: agentFilter, limit: 60 }).then(setRecent).catch(() => setRecent([])); }, [days, agentFilter]);
  useEffect(() => { loadHatifUsers().then(setUsers).catch(() => {}); }, []);

  const nameById = useMemo(() => {
    const m = new Map();
    users.forEach(u => { if (u.userId) m.set(String(u.userId), u.name || u.email || null); });
    return m;
  }, [users]);
  const fmtWhen = (iso) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' }); } catch { return String(iso).slice(0, 16); } };
  const fmtDur = (s) => { const n = Number(s) || 0; if (!n) return '—'; const m = Math.floor(n / 60); const sec = n % 60; return m ? `${m}د ${sec}ث` : `${sec}ث`; };
  const sentLabel = (v) => { const n = Number(v); if (!n) return '—'; return n >= 4 ? `😊 ${n.toFixed(1)}` : n <= 2 ? `😞 ${n.toFixed(1)}` : `😐 ${n.toFixed(1)}`; };
  // بلا موظف = مكالمة آلية (IVR/نظام) — لا يمكن صادر بلا موظف إلا آلياً (قرار المستخدم).
  const agentName = (id) => !id ? <span style={{ color: '#8B5CF6', fontWeight: 700 }}>🤖 آلي (IVR)</span>
    : (nameById.get(String(id)) || <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }} title={String(id)}>{String(id).slice(0, 8)}…</span>);

  return (
    <Card style={{ padding: 18, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800 }}>👥 أداء الفريق — الإسناد والنشاط</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>
            مَن يتولّى المحادثات في هاتف — من أحداث «تعيين الموظف» (webhook مساحة العمل).
          </div>
        </div>
        <select value={days} onChange={e => setDays(Number(e.target.value))}
          style={{ padding: '7px 10px', borderRadius: 8, fontSize: 12.5 }}>
          <option value={7}>آخر 7 أيام</option>
          <option value={30}>آخر 30 يوماً</option>
          <option value={90}>آخر 90 يوماً</option>
        </select>
      </div>

      {/* مكالمات الفريق الحقيقية — من سجلّ هاتف (hatif_call_log عبر السحب). */}
      <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)', marginTop: 4 }}>📞 المكالمات (وارد + صادر)</div>
      {calls == null ? <div style={{ padding: 20, textAlign: 'center' }}><Spinner/></div>
        : !calls.length ? (
          <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 2px' }}>لا مكالمات في هذه الفترة (السحب كل 30 دقيقة).</div>
        ) : (
          <table className="m-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ textAlign: 'right', color: 'var(--muted)', fontSize: 11.5 }}>
              <th style={{ padding: '7px 9px' }} data-label="">الموظف</th>
              <th style={{ padding: '7px 9px' }}>مكالمات</th>
              <th style={{ padding: '7px 9px' }}>مردودة</th>
              <th style={{ padding: '7px 9px' }}>وارد</th>
              <th style={{ padding: '7px 9px' }}>صادر</th>
              <th style={{ padding: '7px 9px' }}>إجمالي التحدّث</th>
              <th style={{ padding: '7px 9px' }}>متوسط المكالمة</th>
              <th style={{ padding: '7px 9px' }}>المشاعر</th>
              <th style={{ padding: '7px 9px' }}>آخر مكالمة</th>
            </tr></thead>
            <tbody>
              {calls.map(r => (
                <tr key={r.user_id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 9px', fontWeight: 700 }} data-label="الموظف">{agentName(r.user_id)}</td>
                  <td style={{ padding: '8px 9px', fontFamily: 'var(--font-mono)', fontWeight: 700 }} data-label="مكالمات">{r.calls}</td>
                  <td style={{ padding: '8px 9px', fontFamily: 'var(--font-mono)' }} data-label="مردودة">{r.answered}</td>
                  <td style={{ padding: '8px 9px', fontFamily: 'var(--font-mono)' }} data-label="وارد">{r.inbound}</td>
                  <td style={{ padding: '8px 9px', fontFamily: 'var(--font-mono)' }} data-label="صادر">{r.outbound}</td>
                  <td style={{ padding: '8px 9px', fontFamily: 'var(--font-mono)' }} data-label="إجمالي التحدّث">{fmtDur(r.talk_seconds)}</td>
                  <td style={{ padding: '8px 9px', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }} data-label="متوسط المكالمة">{fmtDur(Math.round(r.avg_talk))}</td>
                  <td style={{ padding: '8px 9px' }} data-label="المشاعر">{sentLabel(r.avg_sentiment)}</td>
                  <td style={{ padding: '8px 9px', fontSize: 11.5, color: 'var(--muted)' }} data-label="آخر مكالمة">{fmtWhen(r.last_call)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)', marginTop: 10 }}>💬 إسناد المحادثات (واتساب)</div>
      {rows == null ? <div style={{ padding: 30, textAlign: 'center' }}><Spinner/></div>
        : !rows.length ? (
          <Empty icon="📞" title="لا نشاط بعد"
            sub="يمتلئ تلقائياً كلما تولّى موظف محادثة في هاتف (webhook مساحة العمل يُرسل حدث التعيين)."/>
        ) : (
          <table className="m-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ textAlign: 'right', color: 'var(--muted)', fontSize: 11.5 }}>
              <th style={{ padding: '7px 9px' }} data-label="">الموظف</th>
              <th style={{ padding: '7px 9px' }}>محادثات</th>
              <th style={{ padding: '7px 9px' }}>جهات اتصال</th>
              <th style={{ padding: '7px 9px' }}>إسنادات</th>
              <th style={{ padding: '7px 9px' }}>أحداث</th>
              <th style={{ padding: '7px 9px' }}>آخر نشاط</th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.agent_id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 9px', fontWeight: 700 }} data-label="الموظف">
                    {nameById.get(String(r.agent_id)) || <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }} title={String(r.agent_id)}>{String(r.agent_id).slice(0, 8)}…</span>}
                  </td>
                  <td style={{ padding: '8px 9px', fontFamily: 'var(--font-mono)', fontWeight: 700 }} data-label="محادثات">{r.conversations}</td>
                  <td style={{ padding: '8px 9px', fontFamily: 'var(--font-mono)' }} data-label="جهات اتصال">{r.contacts}</td>
                  <td style={{ padding: '8px 9px', fontFamily: 'var(--font-mono)' }} data-label="إسنادات">{r.assignments}</td>
                  <td style={{ padding: '8px 9px', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }} data-label="أحداث">{r.events}</td>
                  <td style={{ padding: '8px 9px', fontSize: 11.5, color: 'var(--muted)' }} data-label="آخر نشاط">{fmtWhen(r.last_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      {/* آخر المكالمات — تسجيل + ملخّص AI لكل مكالمة */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)' }}>🎧 آخر المكالمات</div>
        <select value={agentFilter || ''} onChange={e => setAgentFilter(e.target.value || null)}
          style={{ padding: '6px 10px', borderRadius: 8, fontSize: 12, marginInlineStart: 'auto' }}>
          <option value="">كل الموظفين</option>
          {(calls || []).map(c => <option key={c.user_id || 'null'} value={c.user_id || ''}>{c.user_id ? (nameById.get(String(c.user_id)) || String(c.user_id).slice(0, 8) + '…') : '🤖 آلي (IVR)'} ({c.calls})</option>)}
        </select>
      </div>
      {recent == null ? <div style={{ padding: 20, textAlign: 'center' }}><Spinner/></div>
        : !recent.length ? <div style={{ fontSize: 12, color: 'var(--muted)', padding: '4px 2px' }}>لا مكالمات.</div>
        : (
          <div style={{ display: 'grid', gap: 6 }}>
            {recent.map(c => {
              const open = openCall === c.id;
              const inbound = c.call_type === 1;
              const sum = c.ai_summary?.summary;
              const steps = c.ai_summary?.next_steps || c.ai_summary?.nextSteps;
              return (
                <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 9, overflow: 'hidden' }}>
                  <div onClick={() => setOpenCall(open ? null : c.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer', flexWrap: 'wrap', fontSize: 12.5 }}>
                    <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, background: inbound ? 'color-mix(in srgb, #0EA5E9 15%, transparent)' : 'color-mix(in srgb, var(--green) 15%, transparent)', color: inbound ? '#0EA5E9' : 'var(--green)' }}>{inbound ? '↙ وارد' : '↗ صادر'}</span>
                    <b>{agentName(c.user_id)}</b>
                    <span style={{ color: 'var(--muted)' }}>{fmtWhen(c.creation_time)}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{c.pickup_time ? fmtDur(c.talk_seconds) : 'لم تُردّ'}</span>
                    {c.sentiment ? <span>{sentLabel(c.sentiment)}</span> : null}
                    {c.recording_url && <span style={{ color: 'var(--accent)', fontSize: 11 }}>🎙 تسجيل</span>}
                    {c.ai_summary && <span style={{ color: 'var(--accent)', fontSize: 11 }}>📄 ملخّص</span>}
                    <span style={{ marginInlineStart: 'auto', color: 'var(--muted2)' }}>{open ? '▲' : '▼'}</span>
                  </div>
                  {open && (
                    <div style={{ padding: '4px 12px 12px', borderTop: '1px solid var(--border)', display: 'grid', gap: 8, fontSize: 12.5 }}>
                      {c.recording_url && <audio controls preload="none" src={c.recording_url} style={{ width: '100%', height: 34 }}/>}
                      {Array.isArray(sum) && sum.length > 0 && (
                        <div>
                          <div style={{ fontWeight: 700, marginBottom: 4 }}>📄 ملخّص المكالمة</div>
                          <ul style={{ margin: 0, paddingInlineStart: 18, lineHeight: 1.8, color: 'var(--text)' }}>{sum.map((s, i) => <li key={i}>{s}</li>)}</ul>
                        </div>
                      )}
                      {Array.isArray(steps) && steps.length > 0 && (
                        <div>
                          <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--gold)' }}>🎯 الخطوات التالية</div>
                          <ul style={{ margin: 0, paddingInlineStart: 18, lineHeight: 1.8, color: 'var(--muted)' }}>{steps.map((s, i) => <li key={i}>{s}</li>)}</ul>
                        </div>
                      )}
                      {!c.recording_url && !c.ai_summary && <div style={{ color: 'var(--muted)' }}>لا تسجيل ولا تحليل لهذه المكالمة.</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

      <div style={{ fontSize: 10.5, color: 'var(--muted2)', lineHeight: 1.7, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        <b>المكالمات</b> تُسحب من سجلّ هاتف (GET /v1/call/list) كل 30 دقيقة — مع التسجيل والملخّص والمشاعر لكل مكالمة.
        <b> إسناد المحادثات</b> من أحداث «تعيين الموظف» (webhook مساحة العمل). أسماء الموظفين من موظفي هاتف.
      </div>
    </Card>
  );
}

// تاب سجل الحملات — تقرير مجمَّع لكل حملة (كواجهة هاتف: مستهدفون/وصلت/قُرئت/ردود)
// + سجل الرسائل: نقرة الحملة تفتح حالة كل رقم فيها، مع تصدير Excel للحملة.
function CampaignsTab() {
  const { user, can } = useAuth();
  const [ivrOpen, setIvrOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [report, setReport] = useState([]);        // صف لكل حملة
  const [camp, setCamp] = useState('');            // الحملة المفتوحة (فلتر سيرفري)
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [q, setQ] = useState('');
  const [tpl, setTpl] = useState('');
  const [status, setStatus] = useState('');
  const [failWa, setFailWa] = useState(null);      // مستلمو «حملة للفاشلين»
  const [prepFail, setPrepFail] = useState('');
  const [noWa, setNoWa] = useState([]);            // أرقام بلا واتساب (للاتصال)
  const [expNoWa, setExpNoWa] = useState(false);
  const [block, setBlock] = useState([]);          // قائمة الحظر الدائمة
  const [health, setHealth] = useState(null);      // صحة التسليم (كل الحملات)
  const [blkPhone, setBlkPhone] = useState('');
  const [blkName, setBlkName] = useState('');
  const [blkBusy, setBlkBusy] = useState(false);

  const addBlock = async () => {
    if (blkBusy || !blkPhone.trim()) return;
    setBlkBusy(true);
    try {
      await addToBlocklist({ phone: blkPhone, name: blkName || null, reason: 'حظر يدوي', userId: user?.id || null });
      setBlkPhone(''); setBlkName('');
      setBlock(await loadBlocklist());
      toast('أُضيف للحظر — لن يستقبل أي حملة ✓', 'success');
    } catch (e) { toast(e.message || 'تعذّر الإضافة', 'error'); }
    setBlkBusy(false);
  };
  const removeBlock = async (phone) => {
    setBlkBusy(true);
    try { await removeFromBlocklist(phone); setBlock(await loadBlocklist()); toast('أُزيل من الحظر', 'info'); }
    catch (e) { toast(e.message || 'تعذّر الحذف', 'error'); }
    setBlkBusy(false);
  };

  // إعادة استهداف الفاشلين في حملة — يجلب أرقامهم ويفتح مودال الإرسال.
  const campaignFailed = async (name) => {
    if (prepFail) return;
    setPrepFail(name);
    try {
      const recs = await loadCampaignFailures(name);
      if (!recs.length) { toast('لا فاشلون في هذه الحملة', 'info'); return; }
      setFailWa({ name, recs });
    } catch (e) { toast(`تعذّر جلب الفاشلين: ${e.message}`, 'error'); }
    finally { setPrepFail(''); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [log, rep, nw, blk, hl] = await Promise.all([
        loadWhatsAppLog({ limit: camp ? 1000 : 500, campaign: camp || null }),
        loadWhatsAppCampaignReport(),
        loadNoWhatsappList().catch(() => []),
        loadBlocklist().catch(() => []),
        loadWhatsAppDeliveryHealth().catch(() => null),
      ]);
      setRows(log); setReport(rep); setNoWa(nw); setBlock(blk); setHealth(hl);
    } catch { setRows([]); }
    setLoading(false);
  }, [camp]);
  useEffect(() => { load(); }, [load]);

  // تصدير أرقام «بلا واتساب» لفريق الاتصال (رقم/اسم/آخر محاولة/الحملات)
  const exportNoWa = async () => {
    if (expNoWa || !noWa.length) return;
    setExpNoWa(true);
    try {
      const headers = ['الجوال', 'المتجر/العميل', 'آخر محاولة', 'عدد المحاولات', 'الحملات'];
      const dt = (d) => d ? new Date(d).toLocaleString('en-GB') : '';
      const aoa = [['أرقام بلا واتساب — للاتصال', '', new Date().toISOString().slice(0, 10)], [], headers,
        ...noWa.map(r => [r.phone, r.name || '', dt(r.lastAttempt), r.attempts, r.campaigns || ''])];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = headers.map((_, i) => ({ wch: i === 1 ? 28 : i === 4 ? 30 : 15 }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'بلا واتساب');
      rtl(wb);
      await persistAndDownloadExport({ wb, fileName: `ارقام_بلا_واتساب_${new Date().toISOString().slice(0, 10)}.xlsx`, kind: 'no_whatsapp', rowCount: noWa.length, userId: user?.id || null });
      toast(`صُدّر ${noWa.length} رقم للاتصال ✓`, 'success');
    } catch (e) { toast(`فشل التصدير: ${e.message}`, 'error'); }
    setExpNoWa(false);
  };

  // تصدير تفاصيل الحملة المفتوحة (حالة كل رقم) — عبر persistAndDownloadExport (§1.13)
  const exportCampaign = async (list) => {
    if (exporting || !list.length) return;
    setExporting(true);
    try {
      const headers = ['المستلِم', 'الجوال', 'القالب', 'الحملة', 'المُرسِل', 'وقت الإرسال', 'الحالة', 'وصلت', 'قُرئت', 'ردّ', 'نص الرد', 'سبب الفشل'];
      const stTxt = (r) => r.repliedAt ? 'ردّ' : (r.status === 'Failed' || r.error) ? 'فشل' : r.readAt ? 'قُرئت' : r.deliveredAt ? 'وصلت' : 'أُرسلت';
      const dt = (d) => d ? new Date(d).toLocaleString('en-GB') : '';
      const aoa = [
        [`تقرير حملة واتساب${camp ? ` — ${camp}` : ''}`, '', new Date().toISOString().slice(0, 10)],
        [],
        headers,
        ...list.map(r => [r.name || '', r.phone, r.template || '', r.campaign || '', r.sentBy || '',
          dt(r.sentAt), stTxt(r), dt(r.deliveredAt), dt(r.readAt), dt(r.repliedAt), r.replyBody || '', r.error || '']),
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = headers.map((_, i) => ({ wch: i === 0 ? 28 : 15 }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'الرسائل');
      rtl(wb);
      await persistAndDownloadExport({
        wb, fileName: `حملة_واتساب_${(camp || 'الكل').replace(/[\\/:*?"<>|]/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`,
        kind: 'whatsapp_campaign', rowCount: list.length, userId: user?.id || null,
      });
      toast(`صُدّر ${list.length} رسالة ✓`, 'success');
    } catch (e) { toast(`فشل التصدير: ${e.message}`, 'error'); }
    setExporting(false);
  };

  const templates = [...new Set((rows || []).map(r => r.template).filter(Boolean))];
  const filtered = (rows || []).filter(r => {
    if (tpl && r.template !== tpl) return false;
    if (status) {
      const s = r.repliedAt ? 'replied' : (r.status === 'Failed' || r.error) ? 'failed' : r.readAt ? 'read' : r.deliveredAt ? 'delivered' : 'sent';
      if (s !== status) return false;
    }
    if (q) { const s = q.trim().toLowerCase(); if (![r.name, r.phone, r.campaign].some(v => String(v ?? '').toLowerCase().includes(s))) return false; }
    return true;
  });

  const stats = {
    total: (rows || []).length,
    delivered: (rows || []).filter(r => r.deliveredAt || r.readAt).length,
    read: (rows || []).filter(r => r.readAt).length,
    replied: (rows || []).filter(r => r.repliedAt).length,
    failed: (rows || []).filter(r => r.status === 'Failed' || r.error).length,
  };
  const selStyle = { padding: '8px 10px', border: '1px solid var(--border2)', borderRadius: 9, background: 'var(--surface)', color: 'var(--text)', fontSize: 12 };

  if (rows == null) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner/></div>;

  const pct = (n, d) => d ? `${Math.round(n / d * 100)}%` : '—';
  const fmt0 = (n) => Number(n || 0).toLocaleString('en-US');
  const anyStatus = report.some(c => c.delivered || c.read || c.replied);
  const rth = { padding: '9px 11px', fontSize: 10.5, color: 'var(--muted)', whiteSpace: 'nowrap', textAlign: 'right' };
  const rtd = { padding: '9px 11px', fontSize: 12, whiteSpace: 'nowrap' };

  const HEALTH_TONE = { delivered: 'var(--green)', read: 'var(--green2)', replied: '#3B82F6', failed: 'var(--red)', pending: 'var(--gold)' };
  const reasonAr = (r) => /undeliverable/i.test(r) ? 'الرقم بلا واتساب (دائم)'
    : /healthy ecosystem/i.test(r) ? 'خنق جودة من ميتا (تسويق لغير متفاعلين)'
    : /experiment/i.test(r) ? 'تجربة ميتا مؤقتة'
    : /invalid|not.*valid/i.test(r) ? 'رقم غير صالح' : r;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ── صحة التسليم عبر كل الحملات (تسليم/قراءة/رفض + أسباب) ── */}
      {health && health.total > 0 && (
        <Card style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>📡 صحة التسليم — كل الحملات ({fmt0(health.total)} رسالة)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))', gap: 8 }}>
            {[['وُصِّلت', health.delivered, 'delivered'], ['قُرئت', health.read, 'read'], ['ردّ حقيقي', health.replied, 'replied'],
              ['رُفضت', health.failed, 'failed'], ['قيد الإرسال', health.pending, 'pending']].map(([l, v, k]) => (
              <div key={k} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>{l}</div>
                <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-mono)', color: HEALTH_TONE[k] }}>{fmt0(v)}</div>
                <div style={{ fontSize: 10, color: 'var(--muted2)' }}>{pct(v, health.total)}</div>
              </div>
            ))}
          </div>
          {health.reasons.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>أسباب الرفض:</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {health.reasons.map((r, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--red)', minWidth: 42 }}>{fmt0(r.n)}</span>
                    <span style={{ flex: 1 }}>{reasonAr(r.reason)}</span>
                    {/undeliverable/i.test(r.reason) && <span style={{ fontSize: 10.5, color: 'var(--muted2)' }}>يُستبعَد آلياً ✓</span>}
                    {/healthy ecosystem/i.test(r.reason) && <span style={{ fontSize: 10.5, color: 'var(--gold)' }}>استهدف أضيق</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ── تقرير الحملات (كواجهة هاتف) — نقرة الحملة تفتح رسائلها ── */}
      <div style={{ fontSize: 13, fontWeight: 700 }}>📊 تقرير الحملات</div>
      {!anyStatus && report.length > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--gold)', background: 'color-mix(in srgb, var(--gold) 8%, transparent)',
          border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)', borderRadius: 8, padding: '8px 12px' }}>
          ⚠️ أعمدة «وصلت/قُرئت/ردّ» كلها صفر — webhook هاتف غير مضبوط. اضبطه مرة واحدة من
          هاتف: الإعدادات ← API Connect ← Webhook URL (اطلب الرابط من المدير) وستتحدّث الحالات تلقائياً.
        </div>
      )}
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
        <table className="m-cards" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: 'var(--surface2)' }}>
            {['الحملة', 'القالب', 'آخر إرسال', 'المستهدفون', 'وصلت', 'قُرئت', 'ردّوا', 'فشل'].map(h => <th key={h} style={rth}>{h}</th>)}
          </tr></thead>
          <tbody>
            {report.map(c => (
              <tr key={c.name} onClick={() => setCamp(camp === c.name ? '' : c.name)}
                style={{ borderTop: '1px solid var(--border)', cursor: 'pointer',
                  background: camp === c.name ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent' }}>
                <td data-label="" style={{ ...rtd, fontWeight: 700, whiteSpace: 'normal' }}>{camp === c.name ? '▾ ' : ''}{c.name}</td>
                <td data-label="القالب" style={{ ...rtd, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{c.template || '—'}</td>
                <td data-label="آخر إرسال" style={{ ...rtd, color: 'var(--muted)' }}>{c.lastSent ? new Date(c.lastSent).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' }) : '—'}</td>
                <td data-label="المستهدفون" style={{ ...rtd, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{c.targets}</td>
                <td data-label="وصلت" style={{ ...rtd, fontFamily: 'var(--font-mono)' }}>{c.delivered} <span style={{ color: 'var(--muted2)', fontSize: 10.5 }}>({pct(c.delivered, c.targets)})</span></td>
                <td data-label="قُرئت" style={{ ...rtd, fontFamily: 'var(--font-mono)', color: 'var(--green2)' }}>{c.read} <span style={{ color: 'var(--muted2)', fontSize: 10.5 }}>({pct(c.read, c.targets)})</span></td>
                <td data-label="ردّوا" style={{ ...rtd, fontFamily: 'var(--font-mono)', color: '#3B82F6' }}>{c.replied}</td>
                <td data-label="فشل" style={{ ...rtd }} onClick={e => e.stopPropagation()}>
                  <span style={{ fontFamily: 'var(--font-mono)', color: c.failed ? 'var(--red)' : 'var(--muted2)' }}>{c.failed}</span>
                  {c.failed > 0 && (
                    <button onClick={() => campaignFailed(c.name)} disabled={!!prepFail} title="أعد الإرسال للفاشلين"
                      style={{ marginInlineStart: 8, border: '1px solid var(--border)', background: 'var(--bg)', borderRadius: 6, cursor: 'pointer', fontSize: 10.5, padding: '2px 7px', color: 'var(--accent)', fontFamily: 'var(--font-sans)' }}>
                      {prepFail === c.name ? '…' : '📲 حملة للفاشلين'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!report.length && <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>لا حملات بعد</td></tr>}
          </tbody>
        </table>
      </div>

      {/* ── أرقام بلا واتساب (للاتصال) — تُستبعَد آلياً من كل حملة ── */}
      {noWa.length > 0 && (
        <Card style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          border: '1.5px solid color-mix(in srgb, var(--red) 30%, var(--border))', background: 'color-mix(in srgb, var(--red) 5%, transparent)' }}>
          <span style={{ fontSize: 20 }}>🚫</span>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{noWa.length} رقم بلا واتساب — للاتصال بهم</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>«الرقم غير موجود على واتساب» — تُستبعَد آلياً من كل حملة قادمة (لا استثناء يدوي). حوّلها لفريق الاتصال.</div>
          </div>
          <Btn size="sm" variant="ghost" onClick={exportNoWa} disabled={expNoWa}>{expNoWa ? 'يصدّر…' : '📥 تصدير للاتصال'}</Btn>
          {can('campaigns.ivr') && <Btn size="sm" variant="accent" onClick={() => setIvrOpen(true)}>📞 مكالمة آلية</Btn>}
        </Card>
      )}
      {ivrOpen && (
        <IvrCampaignModal open={ivrOpen} onClose={() => setIvrOpen(false)} bucketLabel="اتصال بلا واتساب"
          recipients={noWa.map(r => ({ phone: r.phone, name: r.name, fields: { name: r.name } }))} />
      )}

      {/* ── قائمة الحظر الدائمة — أرقام لا تُراسَل أبداً (رقم شخصي/منصّة/متجر لا يُحذف) ── */}
      <Card style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 18 }}>⛔</span>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>قائمة الحظر الدائمة — {block.length} رقم</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>أرقام تُستبعَد من كل حملة تلقائياً (على مستوى الخادم أيضاً) — لرقم شخصي أو متجر لا يمكن حذفه لأن عليه شحنات/رصيد.</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={blkPhone} onChange={e => setBlkPhone(e.target.value)} placeholder="رقم الجوال (05… أو 9665…)"
            style={{ ...selStyle, minWidth: 170, direction: 'ltr', textAlign: 'right' }} />
          <input value={blkName} onChange={e => setBlkName(e.target.value)} placeholder="الوصف (اختياري)"
            style={{ ...selStyle, minWidth: 150 }} />
          <Btn size="sm" variant="accent" onClick={addBlock} disabled={blkBusy || !blkPhone.trim()}>{blkBusy ? '…' : '⛔ احظر'}</Btn>
        </div>
        {block.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {block.map(b => (
              <div key={b.phone} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
                borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, direction: 'ltr' }}>{b.phone}</span>
                <span style={{ color: 'var(--muted)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name || b.reason || ''}</span>
                <button onClick={() => removeBlock(b.phone)} disabled={blkBusy} title="إزالة من الحظر"
                  style={{ border: '1px solid var(--border)', background: 'var(--bg)', borderRadius: 6, cursor: 'pointer', fontSize: 10.5, padding: '2px 8px', color: 'var(--muted)' }}>إزالة ✕</button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── سجل الرسائل (المفلتر على الحملة المفتوحة إن وُجدت) ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>✉️ سجل الرسائل{camp ? ` — ${camp}` : ''}</span>
        {camp && <Btn size="sm" variant="ghost" onClick={() => setCamp('')}>عرض الكل ✕</Btn>}
      </div>
      {/* مؤشّرات */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--text2)' }}>
        <span>الإجمالي <b style={{ fontFamily: 'var(--font-mono)' }}>{stats.total}</b></span>
        <span>وصلت <b style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{stats.delivered}</b></span>
        <span>قُرئت <b style={{ color: 'var(--green2)', fontFamily: 'var(--font-mono)' }}>{stats.read}</b></span>
        <span>ردّوا <b style={{ color: '#3B82F6', fontFamily: 'var(--font-mono)' }}>{stats.replied}</b></span>
        <span>فشل <b style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>{stats.failed}</b></span>
        <span style={{ marginInlineStart: 'auto', display: 'inline-flex', gap: 6 }}>
          <Btn size="sm" variant="ghost" onClick={() => exportCampaign(filtered)} disabled={exporting || !filtered.length}>
            {exporting ? 'يصدّر…' : '📥 تصدير التقرير'}
          </Btn>
          <Btn size="sm" variant="ghost" onClick={load} disabled={loading}><RefreshCw size={13} className={loading ? 'spin' : ''}/> تحديث</Btn>
        </span>
      </div>
      {/* فلاتر */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="ابحث بالاسم/الجوال/الحملة…"
          style={{ ...selStyle, flex: 1, minWidth: 180 }}/>
        <select value={tpl} onChange={e => setTpl(e.target.value)} style={selStyle}>
          <option value="">كل القوالب</option>
          {templates.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} style={selStyle}>
          <option value="">كل الحالات</option>
          <option value="sent">أُرسلت</option>
          <option value="delivered">وصلت</option>
          <option value="read">قُرئت</option>
          <option value="replied">ردّ</option>
          <option value="failed">فشل</option>
        </select>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>عرض {filtered.length} من {stats.total} رسالة</div>
      <CampaignLogTable rows={filtered}/>

      {failWa && (
        <WhatsAppSendModal open recipients={failWa.recs}
          bucketLabel={`إعادة إرسال — ${failWa.name}`}
          onClose={() => setFailWa(null)} onSent={() => { setFailWa(null); load(); }}/>
      )}
    </div>
  );
}

// ── نظام التاقات المؤتمت — يوسم محادثات هاتف بحالة العميل (مديونية/VIP/متوقف/…) ──
function TagSystemCard() {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(null);   // {done,total} أثناء الحلقة
  const load = useCallback(() => { loadTagSyncStatus().then(setSt).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  // مزامنة «الكل دفعة واحدة»: الواجهة تكرّر استدعاء الدالة (كل ~120 لأن مهلة السيرفر 150ث)
  // حتى «متبقٍ 0»، مع شريط تقدّم حي. من منظور المستخدم: ضغطة واحدة + شريط.
  const sync = async () => {
    setBusy(true); setProg({ done: 0, total: null });
    let total = null, done = 0;
    try {
      for (let round = 0; round < 80; round++) {
        const r = await runHatifTagSync(120);
        if (total == null) total = r.changed || 0;
        done += (r.applied || 0);
        setProg({ done, total });
        if (!r.remaining) break;
        if ((r.applied || 0) === 0) break;   // لا تقدّم (المتبقّي غير قابل للتطبيق: بلا محادثة/تعذّر) — توقّف
      }
      toast(`اكتملت المزامنة — طُبِّق ${done} تاق`, 'success');
    } catch (e) { toast(e.message || 'فشل', 'error'); }
    finally { setBusy(false); setProg(null); load(); }
  };
  const TAGS = [['عليه مديونية', '#DC2626'], ['متأخر سداد', '#F97316'], ['رصيد سالب', '#DC2626'], ['VIP', '#F59E0B'], ['نشط', '#16A34A'], ['متوقف', '#6B7280'], ['جديد', '#06B6D4'], ['دفع مسبق', '#8B5CF6'], ['دفع لاحق', '#3B82F6'], ['عميل محتمل', '#3B82F6'], ['بلاك لست', '#111827']];
  const [allTags, setAllTags] = useState(null);
  const OURS = new Set(['عليه مديونية', 'متأخر سداد', 'رصيد سالب', 'VIP', 'نشط', 'متوقف', 'جديد', 'دفع مسبق', 'دفع لاحق', 'عميل محتمل', 'بلاك لست']);
  const showTags = async () => { setAllTags('loading'); try { setAllTags(await loadHatifTags()); } catch { setAllTags([]); } };
  return (
    <Card style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700 }}>🏷️ نظام التاقات المؤتمت</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
        يوسم محادثة كل عميل في هاتف <b>تلقائياً بحالته</b> من بياناتنا (11 تاق تحليلي). رقم بعدة متاجر = يؤخذ <b>الأعلى شحناً</b>.
        <b>نظام مؤتمت بالكامل — صفر تاق يدوي:</b> يُنشئ الناقص بإيموجي مثبّتة، و<b>يحذف أي تاق يدوي</b> (اجتماع/شكوى/…)، ويطبّق المتغيّر فقط. مزامنة كل 20 دقيقة.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {TAGS.map(([n, c]) => (
          <span key={n} style={{ padding: '4px 11px', borderRadius: 999, fontSize: 12, fontWeight: 600,
            border: `1.5px solid ${c}`, background: `color-mix(in srgb, ${c} 14%, transparent)`, color: 'var(--text)' }}>{n}</span>
        ))}
      </div>
      {st && (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          محادثات تستحق تاقاً: <b style={{ color: 'var(--text)' }}>{st.tagged ?? '—'}</b> من {st.desired ?? '—'} · <b style={{ color: 'var(--green2)' }}>مطبَّقة فعلاً: {st.applied}</b>
          {st.tagged != null && st.applied < st.tagged && <span style={{ color: 'var(--gold)' }}> — اضغط «مزامنة» لإكمال الباقي</span>}
        </div>
      )}
      {prog && (
        <div style={{ fontSize: 12 }}>
          جارٍ المزامنة… طُبِّق <b>{prog.done}</b>{prog.total ? ` من ~${prog.total}` : ''} (لا تُغلق الصفحة)
          <div style={{ height: 7, background: 'var(--border)', borderRadius: 999, marginTop: 6, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${prog.total ? Math.min(100, Math.round((prog.done / Math.max(1, prog.total)) * 100)) : 30}%`, background: 'var(--accent)', transition: 'width .3s' }}/>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Btn variant="accent" onClick={sync} disabled={busy}>{busy ? 'جارٍ المزامنة…' : '🔄 مزامنة كل التاقات'}</Btn>
        <Btn variant="ghost" onClick={showTags}>🔖 عرض تاقات هاتف</Btn>
        <span style={{ fontSize: 11, color: 'var(--muted2)' }}>يعالج الكل دفعة واحدة (يقسّمها السيرفر آلياً) مع شريط تقدّم.</span>
      </div>
      {allTags && allTags !== 'loading' && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>تاقات هاتف ({allTags.length}) — <span style={{ color: 'var(--green2)' }}>المخضّرة يديرها النظام</span>، وغيرها يدوية <b>ستُحذف</b> في المزامنة القادمة:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {allTags.map(t => {
              const ours = OURS.has(String(t.name).trim());
              return <span key={t.id} style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 600,
                border: `1.5px solid ${ours ? 'var(--green2)' : 'var(--border)'}`, background: ours ? 'color-mix(in srgb, var(--green) 12%, transparent)' : 'var(--surface2)', color: 'var(--text)' }}>{t.name}</span>;
            })}
          </div>
        </div>
      )}
      {allTags === 'loading' && <div style={{ fontSize: 12, color: 'var(--muted)' }}>جارٍ جلب التاقات من هاتف…</div>}
    </Card>
  );
}
