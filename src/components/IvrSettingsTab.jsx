// تاب المكالمات الآلية (IVR) داخل «إعدادات واتساب» — الإعدادات + السكربتات + سجل المكالمات.
// السكربت = نص منطوق (TTS) + خيارات ضغط (DTMF)؛ كل ضغطة تُنفّذ إجراءً عبر ivr-webhook.
import { useState, useEffect } from 'react';
import { ShieldCheck, CheckCircle2, X, Save, Plus, Trash2, PhoneCall, Upload } from 'lucide-react';
import { Card, Btn, Spinner, Empty, toast } from './UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadIvrConfig, saveIvrConfig, verifyIvr, launchIvrCampaign, loadIvrCampaigns, loadIvrCalls, ivrStatusBadge, IVR_ACTIONS, uploadIvrAudio } from '../lib/ivrService.js';
import { loadWhatsAppConfig } from '../lib/whatsappService.js';

export default function IvrTab() {
  const { can } = useAuth();
  const mayConfigure = can('whatsapp.configure');
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [verified, setVerified] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [camps, setCamps] = useState([]);
  const [openCamp, setOpenCamp] = useState('');
  const [calls, setCalls] = useState([]);
  const [loadingCalls, setLoadingCalls] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testing, setTesting] = useState(false);
  const [templates, setTemplates] = useState([]);   // قوالب واتساب المعتمدة (لأتمتة الرد/الضغطة)
  const [uploadingKey, setUploadingKey] = useState('');

  useEffect(() => {
    loadIvrConfig().then(setCfg);
    loadIvrCampaigns().then(setCamps);
    loadWhatsAppConfig().then(c => setTemplates(c?.templates || [])).catch(() => {});
  }, []);

  const onAudioUpload = async (idx, file) => {
    if (!file) return;
    const s = cfg.scripts[idx];
    setUploadingKey(s.key);
    try { const urlStr = await uploadIvrAudio(file, s.key, 'main'); updateScript(idx, { audioUrl: urlStr }); toast('رُفع الصوت ✓', 'success'); }
    catch (e) { toast(e.message || 'فشل رفع الصوت', 'error'); }
    finally { setUploadingKey(''); }
  };
  const onSuccessAudioUpload = async (idx, file) => {
    if (!file) return;
    const s = cfg.scripts[idx];
    setUploadingKey(s.key + '_ok');
    try { const urlStr = await uploadIvrAudio(file, s.key, 'closing'); updateScript(idx, { successAudioUrl: urlStr }); toast('رُفعت رسالة الختام ✓', 'success'); }
    catch (e) { toast(e.message || 'فشل رفع الصوت', 'error'); }
    finally { setUploadingKey(''); }
  };

  const openCampaign = async (name) => {
    setOpenCamp(name); setLoadingCalls(true);
    const rows = await loadIvrCalls({ campaign: name, limit: 500 });
    setCalls(rows); setLoadingCalls(false);
  };

  const save = async () => {
    setSaving(true);
    try { const c = await saveIvrConfig(cfg); setCfg(c); toast('حُفظت إعدادات المكالمات', 'success'); }
    catch (e) { toast(e.message || 'فشل الحفظ', 'error'); }
    finally { setSaving(false); }
  };
  const verify = async () => {
    setVerifying(true);
    try { const r = await verifyIvr(); setVerified(!!r?.ok); } catch { setVerified(false); }
    finally { setVerifying(false); }
  };
  const testCall = async () => {
    if (!testPhone.trim()) { toast('اكتب رقماً للتجربة', 'error'); return; }
    setTesting(true);
    try {
      const r = await launchIvrCampaign({ recipients: [{ phone: testPhone.trim(), name: 'تجربة' }], scriptKey: cfg.defaultScript, campaignName: 'تجربة IVR' });
      toast(r.placed ? 'أُطلقت مكالمة التجربة' : (r.results?.[0]?.error || 'فشلت'), r.placed ? 'success' : 'error');
    } catch (e) { toast(e.message || 'فشل', 'error'); }
    finally { setTesting(false); }
  };

  const updateScript = (idx, patch) => setCfg(c => ({ ...c, scripts: c.scripts.map((s, i) => i === idx ? { ...s, ...patch } : s) }));
  const addScript = () => setCfg(c => {
    const key = 'script_' + (c.scripts.length + 1);
    return { ...c, scripts: [...c.scripts, { key, label: 'سكربت جديد', ttsText: '', options: [{ digit: '1', description: '', action: 'followup' }] }] };
  });
  const removeScript = (idx) => setCfg(c => ({ ...c, scripts: c.scripts.filter((_, i) => i !== idx) }));
  const updateOpt = (si, oi, patch) => setCfg(c => ({ ...c, scripts: c.scripts.map((s, i) => i !== si ? s : { ...s, options: s.options.map((o, j) => j === oi ? { ...o, ...patch } : o) }) }));
  const addOpt = (si) => setCfg(c => ({ ...c, scripts: c.scripts.map((s, i) => i !== si ? s : { ...s, options: [...s.options, { digit: String(s.options.length + 1), description: '', action: 'followup' }] }) }));
  const removeOpt = (si, oi) => setCfg(c => ({ ...c, scripts: c.scripts.map((s, i) => i !== si ? s : { ...s, options: s.options.filter((_, j) => j !== oi) }) }));

  if (!cfg) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner/></div>;
  const inp = { padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12.5 };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Card style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px', lineHeight: 1.7 }}>
          📞 <b style={{ color: 'var(--text)' }}>مكالمات آلية (IVR)</b> عبر هاتف (Voxa): النظام يتصل بالعميل، يقرأ نصاً صوتياً،
          ويلتقط ضغطة العميل (مثلاً <b>1</b> للتحدث مع محصّل، <b>2</b> لإيقاف الاتصالات). <b>مصمَّمة للوصول لمن لا يملك واتساب.</b>
          الضغطة تُنفَّذ آلياً (مهمة متابعة أو حظر اتصال). أطلِق حملة من زر «مكالمة آلية» في صفحات التحصيل/المبيعات.
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: mayConfigure ? 'pointer' : 'default', fontWeight: 600 }}>
          <input type="checkbox" disabled={!mayConfigure} checked={!!cfg.enabled} onChange={e => setCfg({ ...cfg, enabled: e.target.checked })}/>
          تفعيل المكالمات الآلية
        </label>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'grid', gap: 5, fontSize: 12.5 }}>الصوت
            <select disabled={!mayConfigure} value={cfg.ttsVoice} onChange={e => setCfg({ ...cfg, ttsVoice: e.target.value })} style={inp}>
              <option value="Female">أنثى</option><option value="Male">ذكر</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 5, fontSize: 12.5 }}>إعادة تشغيل النص (0-5)
            <input type="number" min={0} max={5} disabled={!mayConfigure} value={cfg.maxAudioRetries} onChange={e => setCfg({ ...cfg, maxAudioRetries: Number(e.target.value) })} style={{ ...inp, width: 90 }}/>
          </label>
          <label style={{ display: 'grid', gap: 5, fontSize: 12.5 }}>مهلة الضغط (مللي)
            <input type="number" min={1000} max={30000} step={500} disabled={!mayConfigure} value={cfg.inputTimeoutMs} onChange={e => setCfg({ ...cfg, inputTimeoutMs: Number(e.target.value) })} style={{ ...inp, width: 110 }}/>
          </label>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>السكربتات الصوتية</div>
            {mayConfigure && <Btn size="sm" variant="ghost" icon={<Plus size={13}/>} onClick={addScript}>سكربت</Btn>}
          </div>
          {cfg.scripts.map((s, si) => (
            <div key={si} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, display: 'grid', gap: 9, background: 'var(--surface2)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input disabled={!mayConfigure} value={s.label} onChange={e => updateScript(si, { label: e.target.value })} placeholder="اسم السكربت" style={{ ...inp, flex: 1, minWidth: 140, fontWeight: 600 }}/>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--muted)' }}>
                  <input type="radio" name="defScript" disabled={!mayConfigure} checked={cfg.defaultScript === s.key} onChange={() => setCfg({ ...cfg, defaultScript: s.key })}/> افتراضي
                </label>
                {mayConfigure && cfg.scripts.length > 1 && <Btn size="sm" variant="ghost" title="حذف" onClick={() => removeScript(si)}><Trash2 size={13}/></Btn>}
              </div>
              <textarea disabled={!mayConfigure || !!s.audioUrl} value={s.ttsText} onChange={e => updateScript(si, { ttsText: e.target.value })} rows={3}
                placeholder="النص المنطوق — استخدم {name} أو {amount} لملء بيانات العميل" style={{ ...inp, resize: 'vertical', lineHeight: 1.7, opacity: s.audioUrl ? 0.5 : 1 }}/>

              {/* صوت مرفوع (WAV) — يتقدّم على النص المنطوق */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
                {s.audioUrl ? (
                  <>
                    <audio src={s.audioUrl} controls style={{ height: 30, maxWidth: 220 }}/>
                    <span style={{ color: 'var(--green2)', fontSize: 11 }}>✓ صوت مرفوع (يُشغَّل بدل النص)</span>
                    {mayConfigure && <Btn size="sm" variant="ghost" title="إزالة الصوت" onClick={() => updateScript(si, { audioUrl: '' })}><X size={12}/></Btn>}
                  </>
                ) : mayConfigure && (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--accent)', fontSize: 12 }}>
                    <Upload size={13}/> {uploadingKey === s.key ? 'يرفع…' : 'ارفع صوتك (WAV) — بدل الآلي'}
                    <input type="file" accept=".wav,audio/wav" style={{ display: 'none' }}
                      onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; onAudioUpload(si, f); }}/>
                  </label>
                )}
              </div>

              {/* أتمتة: إن رُدّ على المكالمة → أرسل قالب واتساب تلقائياً */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--muted)' }}>📲 إن رُدّ عليها → أرسل قالب:</span>
                <select disabled={!mayConfigure} value={s.onAnswerTemplate || ''} onChange={e => updateScript(si, { onAnswerTemplate: e.target.value })} style={{ ...inp, minWidth: 180 }}>
                  <option value="">— بلا قالب —</option>
                  {templates.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>

              {/* رسالة الختام (شكراً) — تُشغَّل بعد ضغطة صحيحة ثم يُقفل. ملف WAV (Voxa لا يدعم نصاً للختام) */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
                <span style={{ color: 'var(--muted)' }}>🙏 رسالة الختام (شكراً ثم يُقفل):</span>
                {s.successAudioUrl ? (
                  <>
                    <audio src={s.successAudioUrl} controls style={{ height: 30, maxWidth: 200 }}/>
                    {mayConfigure && <Btn size="sm" variant="ghost" title="إزالة" onClick={() => updateScript(si, { successAudioUrl: '' })}><X size={12}/></Btn>}
                  </>
                ) : mayConfigure && (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--accent)' }}>
                    <Upload size={13}/> {uploadingKey === s.key + '_ok' ? 'يرفع…' : 'ارفع «شكراً» (WAV)'}
                    <input type="file" accept=".wav,audio/wav" style={{ display: 'none' }}
                      onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; onSuccessAudioUpload(si, f); }}/>
                  </label>
                )}
              </div>

              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)' }}>خيارات الضغط (كل رقم = إجراء + قالب اختياري):</div>
              {s.options.map((o, oi) => (
                <div key={oi} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input disabled={!mayConfigure} value={o.digit} onChange={e => updateOpt(si, oi, { digit: e.target.value })} placeholder="#" style={{ ...inp, width: 46, textAlign: 'center' }}/>
                  <input disabled={!mayConfigure} value={o.description} onChange={e => updateOpt(si, oi, { description: e.target.value })} placeholder="وصف الخيار" style={{ ...inp, flex: 1, minWidth: 120 }}/>
                  <select disabled={!mayConfigure} value={o.action} onChange={e => updateOpt(si, oi, { action: e.target.value })} style={{ ...inp, minWidth: 190 }}>
                    {IVR_ACTIONS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                  </select>
                  <select disabled={!mayConfigure} value={o.template || ''} onChange={e => updateOpt(si, oi, { template: e.target.value })} style={{ ...inp, minWidth: 150 }} title="قالب واتساب يُرسَل عند ضغط هذا الرقم">
                    <option value="">📲 بلا قالب</option>
                    {templates.map(t => <option key={t} value={t}>+ {t}</option>)}
                  </select>
                  {mayConfigure && s.options.length > 1 && <Btn size="sm" variant="ghost" title="حذف" onClick={() => removeOpt(si, oi)}><X size={13}/></Btn>}
                </div>
              ))}
              {mayConfigure && <Btn size="sm" variant="ghost" icon={<Plus size={12}/>} onClick={() => addOpt(si)}>خيار</Btn>}
            </div>
          ))}
        </div>

        {mayConfigure && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <Btn variant="accent" icon={<Save size={14}/>} onClick={save} disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ'}</Btn>
            <Btn variant="ghost" icon={<ShieldCheck size={14}/>} onClick={verify} disabled={verifying}>{verifying ? 'جارٍ التحقّق…' : 'تحقّق من الاتصال'}</Btn>
            {verified === true && <span style={{ color: 'var(--green2)', fontSize: 12 }}><CheckCircle2 size={13} style={{ verticalAlign: -2 }}/> يعمل</span>}
            {verified === false && <span style={{ color: 'var(--red)', fontSize: 12 }}><X size={13} style={{ verticalAlign: -2 }}/> فشل — راجع الأسرار</span>}
            {can('campaigns.ivr') && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginInlineStart: 'auto' }}>
                <input value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="05XXXXXXXX" style={{ ...inp, width: 140, direction: 'ltr' }}/>
                <Btn size="sm" variant="ghost" icon={<PhoneCall size={13}/>} onClick={testCall} disabled={testing || !cfg.enabled}>اتصال تجربة</Btn>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card style={{ padding: 18 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>📋 سجل المكالمات</div>
        {!camps.length ? <Empty title="لا مكالمات بعد" subtitle="أطلِق حملة مكالمات من صفحات التحصيل/المبيعات."/> : (
          <div style={{ display: 'grid', gap: 12 }}>
            <table className="m-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr style={{ textAlign: 'right', color: 'var(--muted)', fontSize: 11.5 }}>
                <th style={{ padding: '6px 8px' }} data-label="">الحملة</th>
                <th style={{ padding: '6px 8px' }}>مكالمات</th>
                <th style={{ padding: '6px 8px' }}>رُدّ عليها</th>
                <th style={{ padding: '6px 8px' }}>تفاعل (ضغط)</th>
                <th style={{ padding: '6px 8px' }}>فشل/لا رد</th>
                <th style={{ padding: '6px 8px' }}></th>
              </tr></thead>
              <tbody>
                {camps.map(c => (
                  <tr key={c.campaign} style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => openCampaign(c.campaign)}>
                    <td style={{ padding: '7px 8px', fontWeight: 600 }} data-label="الحملة">{c.campaign}</td>
                    <td style={{ padding: '7px 8px' }} data-label="مكالمات">{c.total}</td>
                    <td style={{ padding: '7px 8px' }} data-label="رُدّ عليها">{c.answered}</td>
                    <td style={{ padding: '7px 8px', color: c.pressed ? 'var(--green2)' : 'var(--muted)' }} data-label="تفاعل">{c.pressed}</td>
                    <td style={{ padding: '7px 8px', color: c.failed ? 'var(--red)' : 'var(--muted)' }} data-label="فشل">{c.failed}</td>
                    <td style={{ padding: '7px 8px', color: 'var(--accent)' }} data-label="">عرض ◂</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {openCamp && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>مكالمات: {openCamp}</div>
                {loadingCalls ? <Spinner/> : !calls.length ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>لا صفوف.</div> : (
                  <table className="m-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead><tr style={{ textAlign: 'right', color: 'var(--muted)', fontSize: 11 }}>
                      <th style={{ padding: '5px 7px' }} data-label="">الاسم</th>
                      <th style={{ padding: '5px 7px' }}>الرقم</th>
                      <th style={{ padding: '5px 7px' }}>الحالة</th>
                      <th style={{ padding: '5px 7px' }}>ضغط</th>
                      <th style={{ padding: '5px 7px' }}>الإجراء</th>
                    </tr></thead>
                    <tbody>
                      {calls.map(r => { const b = ivrStatusBadge(r); return (
                        <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '6px 7px' }} data-label="الاسم">{r.name || '—'}</td>
                          <td style={{ padding: '6px 7px', direction: 'ltr', fontFamily: 'monospace' }} data-label="الرقم">{r.phone}</td>
                          <td style={{ padding: '6px 7px' }} data-label="الحالة"><span style={{ color: b.c, fontWeight: 600 }}>{b.t}</span></td>
                          <td style={{ padding: '6px 7px', fontWeight: 700, color: r.pressed_digit ? 'var(--green2)' : 'var(--muted)' }} data-label="ضغط">{r.pressed_digit || '—'}</td>
                          <td style={{ padding: '6px 7px', color: 'var(--muted)' }} data-label="الإجراء">{r.action_taken === 'followup' ? 'متابعة' : r.action_taken === 'dnc' ? 'إيقاف اتصال' : r.action_taken === 'callback' ? 'معاودة' : r.action_taken === 'none' ? 'بلا' : '—'}</td>
                        </tr>
                      ); })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
