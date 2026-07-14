// إعدادات واتساب (Hatif · هاتف/Voxa) — مكان ثابت لضبط القالب والقناة والتحقّق،
// بدل تكرار الإعداد داخل مودال الإرسال. يُخزَّن في app_settings key='whatsapp_config'
// ويُستخدَم في حملات التحصيل (/customer-money) وإعادة الاستهداف. اللغة ثابتة ar.
import { useState, useEffect, useCallback } from 'react';
import { MessageCircle, RefreshCw, ShieldCheck, CheckCircle2, X, Save, Plus, Trash2 } from 'lucide-react';
import { Card, Btn, Spinner, Empty, PageHeader, Input, toast } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadWhatsAppConfig, saveWhatsAppConfig, verifyWhatsAppKey } from '../lib/whatsappService.js';

export default function WhatsAppSettings({ isActive = true }) {
  const { can } = useAuth();
  const [cfg, setCfg] = useState(null);
  const [newTpl, setNewTpl] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setCfg(await loadWhatsAppConfig()); } catch (e) { toast(e.message, 'error'); }
    setLoading(false);
  }, []);
  useEffect(() => { if (isActive) load(); }, [isActive, load]);

  if (!can('collections.view')) return <div style={{ padding: 40 }}><Empty icon="🔒" title="لا صلاحية"/></div>;

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

  return (
    <div style={{ padding: '20px 24px 60px', maxWidth: 660, margin: '0 auto' }}>
      <PageHeader icon={<MessageCircle size={22}/>} iconColor="#22C55E"
        title="إعدادات واتساب"
        subtitle="الإرسال عبر Hatif · هاتف (Voxa) — قالب معتمد + قناة"
        actions={<Btn size="sm" variant="ghost" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/></Btn>}
      />
      {!cfg ? <div style={{ padding: 40, textAlign: 'center' }}><Spinner/></div> : (
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
                  <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, cursor: 'pointer', fontSize: 12.5 }}>
                      <input type="radio" name="defaultTpl" checked={cfg.templateName === t} onChange={() => setCfg({ ...cfg, templateName: t })}/>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{t}</span>
                      {cfg.templateName === t && <span style={{ fontSize: 10.5, color: 'var(--green2)' }}>افتراضي</span>}
                    </label>
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
    </div>
  );
}
