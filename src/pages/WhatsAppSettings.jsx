// إعدادات واتساب (Hatif · هاتف/Voxa) — مكان ثابت لضبط القالب والقناة والتحقّق،
// بدل تكرار الإعداد داخل مودال الإرسال. يُخزَّن في app_settings key='whatsapp_config'
// ويُستخدَم في حملات التحصيل (/customer-money) وإعادة الاستهداف. اللغة ثابتة ar.
import { useState, useEffect, useCallback } from 'react';
import { MessageCircle, RefreshCw, ShieldCheck, CheckCircle2, X, Save, Plus, Trash2 } from 'lucide-react';
import IvrCampaignModal from '../components/IvrCampaignModal.jsx';
import { Card, Btn, Spinner, Empty, PageHeader, Input, toast } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import IvrTab from '../components/IvrSettingsTab.jsx';
import { loadWhatsAppConfig, saveWhatsAppConfig, verifyWhatsAppKey,
  loadZatcaAlertConfig, saveZatcaAlertConfig, previewZatcaAlert, sendZatcaAlertNow,
  loadWhatsAppLog, loadWhatsAppCampaignReport, loadCampaignFailures, loadNoWhatsappList,
  loadBlocklist, addToBlocklist, removeFromBlocklist, loadWhatsAppDeliveryHealth, loadHatifUsers,
  runHatifTagSync, loadTagSyncStatus } from '../lib/whatsappService.js';
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
    <div style={{ padding: '24px 28px 80px', maxWidth: (tab === 'campaigns' || tab === 'ivr') ? 1100 : 660, margin: '0 auto' }}>
      <PageHeader icon={<MessageCircle size={22}/>} iconColor="#22C55E"
        title="واتساب"
        subtitle="الإرسال عبر Hatif · هاتف (Voxa) — إعدادات القوالب + سجل الحملات"
        actions={<Btn size="sm" variant="ghost" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/></Btn>}
      />

      {/* مبدّل: الإعدادات / سجل الحملات */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[['settings', '⚙️ الإعدادات'], ['campaigns', '📋 سجل الحملات'], ['ivr', '📞 المكالمات الآلية']].map(([v, lbl]) => (
          <button key={v} onClick={() => setTab(v)} style={{
            padding: '8px 16px', borderRadius: 9, cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
            border: `1.5px solid ${tab === v ? '#22C55E' : 'var(--border)'}`,
            background: tab === v ? 'color-mix(in srgb, #22C55E 12%, transparent)' : 'transparent', color: 'var(--text)',
          }}>{lbl}</button>
        ))}
      </div>

      {tab === 'ivr' ? <IvrTab/> :
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
  const load = useCallback(() => { loadTagSyncStatus().then(setSt).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  const sync = async () => {
    setBusy(true);
    try { const r = await runHatifTagSync(120); toast(`طُبِّق ${r.applied} · متبقٍ ${r.remaining}`, 'success'); load(); }
    catch (e) { toast(e.message || 'فشل', 'error'); }
    finally { setBusy(false); }
  };
  const TAGS = [['عليه مديونية', '#DC2626'], ['VIP', '#F59E0B'], ['متوقف', '#6B7280'], ['دفع مسبق', '#8B5CF6'], ['عميل محتمل', '#3B82F6'], ['ردّ بشري', '#16A34A']];
  return (
    <Card style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700 }}>🏷️ نظام التاقات المؤتمت</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
        يوسم محادثة كل عميل في هاتف <b>تلقائياً بحالته</b> من بياناتنا، فيراها فريقك في صندوق الوارد. رقم بعدة متاجر = يؤخذ <b>الأعلى شحناً</b>.
        يعمل عبر مزامنة دورية كل 20 دقيقة (تُنشئ التاقات الناقصة في هاتف وتطبّق المتغيّر فقط).
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {TAGS.map(([n, c]) => (
          <span key={n} style={{ padding: '4px 11px', borderRadius: 999, fontSize: 12, fontWeight: 600,
            border: `1.5px solid ${c}`, background: `color-mix(in srgb, ${c} 14%, transparent)`, color: 'var(--text)' }}>{n}</span>
        ))}
      </div>
      {st && (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          محادثات مؤهّلة: <b style={{ color: 'var(--text)' }}>{st.desired ?? '—'}</b> · منها بتاق: <b style={{ color: 'var(--text)' }}>{st.tagged ?? '—'}</b> · طُبِّق فعلاً: <b style={{ color: 'var(--green2)' }}>{st.applied}</b>
        </div>
      )}
      <div>
        <Btn variant="accent" onClick={sync} disabled={busy}>{busy ? 'جارٍ المزامنة…' : '🔄 مزامنة التاقات الآن'}</Btn>
        <span style={{ fontSize: 11, color: 'var(--muted2)', marginInlineStart: 8 }}>دفعة 120/ضغطة — كرّر حتى «متبقٍ 0» لأول مرة.</span>
      </div>
    </Card>
  );
}
