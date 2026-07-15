// إعدادات واتساب (Hatif · هاتف/Voxa) — مكان ثابت لضبط القالب والقناة والتحقّق،
// بدل تكرار الإعداد داخل مودال الإرسال. يُخزَّن في app_settings key='whatsapp_config'
// ويُستخدَم في حملات التحصيل (/customer-money) وإعادة الاستهداف. اللغة ثابتة ar.
import { useState, useEffect, useCallback } from 'react';
import { MessageCircle, RefreshCw, ShieldCheck, CheckCircle2, X, Save, Plus, Trash2 } from 'lucide-react';
import { Card, Btn, Spinner, Empty, PageHeader, Input, toast } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadWhatsAppConfig, saveWhatsAppConfig, verifyWhatsAppKey,
  loadZatcaAlertConfig, saveZatcaAlertConfig, previewZatcaAlert, sendZatcaAlertNow,
  loadWhatsAppLog } from '../lib/whatsappService.js';
import { CampaignLogTable } from '../components/WhatsAppCampaignLog.jsx';

export default function WhatsAppSettings({ isActive = true }) {
  const { can } = useAuth();
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, z] = await Promise.all([loadWhatsAppConfig(), loadZatcaAlertConfig().catch(() => null)]);
      setCfg(c); setZatca(z || { enabled: false, phone: '', templateName: '' });
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
    <div style={{ padding: '20px 24px 60px', maxWidth: tab === 'campaigns' ? 1100 : 660, margin: '0 auto' }}>
      <PageHeader icon={<MessageCircle size={22}/>} iconColor="#22C55E"
        title="واتساب"
        subtitle="الإرسال عبر Hatif · هاتف (Voxa) — إعدادات القوالب + سجل الحملات"
        actions={<Btn size="sm" variant="ghost" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/></Btn>}
      />

      {/* مبدّل: الإعدادات / سجل الحملات */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[['settings', '⚙️ الإعدادات'], ['campaigns', '📋 سجل الحملات']].map(([v, lbl]) => (
          <button key={v} onClick={() => setTab(v)} style={{
            padding: '8px 16px', borderRadius: 9, cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
            border: `1.5px solid ${tab === v ? '#22C55E' : 'var(--border)'}`,
            background: tab === v ? 'color-mix(in srgb, #22C55E 12%, transparent)' : 'transparent', color: 'var(--text)',
          }}>{lbl}</button>
        ))}
      </div>

      {tab === 'campaigns' ? <CampaignsTab/> :
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

      {/* ── تنبيه زاتكا المسائي — واتساب 9م بتوقيت السعودية بالفواتير التي لم تُرسَل ── */}
      {zatca && (
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

// تاب سجل الحملات — كل رسالة أُرسلت: المستلِم/القالب/الحملة/المُرسِل/الوقت/الحالة + فلاتر.
function CampaignsTab() {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [tpl, setTpl] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await loadWhatsAppLog({ limit: 500 })); } catch { setRows([]); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* مؤشّرات */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--text2)' }}>
        <span>الإجمالي <b style={{ fontFamily: 'var(--font-mono)' }}>{stats.total}</b></span>
        <span>وصلت <b style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{stats.delivered}</b></span>
        <span>قُرئت <b style={{ color: 'var(--green2)', fontFamily: 'var(--font-mono)' }}>{stats.read}</b></span>
        <span>ردّوا <b style={{ color: '#3B82F6', fontFamily: 'var(--font-mono)' }}>{stats.replied}</b></span>
        <span>فشل <b style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>{stats.failed}</b></span>
        <Btn size="sm" variant="ghost" style={{ marginInlineStart: 'auto' }} onClick={load} disabled={loading}><RefreshCw size={13} className={loading ? 'spin' : ''}/> تحديث</Btn>
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
    </div>
  );
}
