import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, CalendarClock, CheckCircle2, Clock3, Database, PlayCircle, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { Btn, Card, Spinner } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { configureOverdueSadadAgent, configureZatcaWorkAgent, loadRecentAgentRuns, loadWorkAgents, previewOverdueSadadAgent, previewZatcaWorkAgent, runOverdueSadadAgent, runZatcaWorkAgent } from '../lib/workAgentService.js';

const SAFETY = {
  monitor: { label: 'مراقبة فقط', color: 'var(--accent)', text: 'يقرأ وينبه دون تعديل البيانات.' },
  limited: { label: 'تنفيذ محدود', color: 'var(--green)', text: 'ينفذ إجراءات آمنة ومحددة مسبقًا.' },
  approval: { label: 'يتطلب موافقة', color: 'var(--gold)', text: 'يجهز النتيجة وينتظر اعتماد المسؤول.' },
  sensitive: { label: 'تنفيذ حساس', color: 'var(--red)', text: 'لا يعمل دون صلاحية واعتماد صريح.' },
};

function StatusPill({ status }) {
  const map = {
    active: ['يعمل', 'var(--green)', 'var(--green-soft)'],
    paused: ['متوقف مؤقتًا', 'var(--gold)', 'var(--gold-soft)'],
    draft: ['قيد التأسيس', 'var(--muted)', 'var(--surface2)'],
    error: ['يحتاج تدخلًا', 'var(--red)', 'var(--red-soft)'],
  };
  const [label, color, background] = map[status] || map.draft;
  return <span style={{ color, background, border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`, padding: '5px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 800 }}>{label}</span>;
}

function AgentCard({ agent, onStart }) {
  const safety = SAFETY[agent.safety_level] || SAFETY.monitor;
  return (
    <Card style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 310 }}>
      <div style={{ padding: '18px 18px 14px', borderBottom: '1px solid var(--border2)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ width: 42, height: 42, display: 'grid', placeItems: 'center', borderRadius: 12, background: 'var(--accent-dim)', color: 'var(--accent)' }}><Bot size={21}/></span>
          <StatusPill status={agent.status}/>
        </div>
        <h3 style={{ margin: '13px 0 5px', fontSize: 17, color: 'var(--text)' }}>{agent.name}</h3>
        <div style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 700 }}>{agent.category}</div>
      </div>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
        <p style={{ margin: 0, color: 'var(--text2)', fontSize: 13, lineHeight: 1.8 }}>{agent.description}</p>
        <div style={{ display: 'grid', gap: 9 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text2)', fontSize: 12.5 }}><CalendarClock size={16} color="var(--accent)"/><b>الجدول:</b> {agent.cadence_label}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text2)', fontSize: 12.5 }}><ShieldCheck size={16} color={safety.color}/><b>{safety.label}:</b> {safety.text}</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(agent.sources || []).map(source => <span key={source} style={{ background: 'var(--surface2)', color: 'var(--muted)', border: '1px solid var(--border2)', borderRadius: 8, padding: '4px 8px', fontSize: 11.5 }}>{source}</span>)}
        </div>
        <div style={{ marginTop: 'auto', paddingTop: 5 }}>
          <Btn variant={agent.status === 'draft' ? 'primary' : 'ghost'} size="full" onClick={() => onStart(agent)} icon={<PlayCircle size={17}/>}>{agent.status === 'draft' ? 'بدء تأسيس الوكيل' : 'عرض إعدادات الوكيل'}</Btn>
        </div>
      </div>
    </Card>
  );
}

export default function WorkAgents({ isActive = true }) {
  const { can } = useAuth();
  const [agents, setAgents] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState(null);

  const openAgent = agent => {
    setSelected(agent); setPreview(null); setNotice('');
    if (agent.agent_key === 'overdue_sadad') {
      const c = agent.config || {};
      setForm({ enabled: agent.status === 'active', dayOfWeek: c.day_of_week ?? 6, hour: c.hour ?? 18,
        minute: c.minute ?? 0, minDays: c.min_overdue_days ?? 30, minBalance: c.min_balance ?? 0.5,
        maxRecipients: c.max_recipients ?? 500 });
    } else if (agent.agent_key === 'zatca_nightly') {
      const c = agent.config || {};
      setForm({ enabled: agent.status === 'active', hour: c.hour ?? 23, minute: c.minute ?? 45, maxInvoices: c.max_invoices ?? 200 });
    } else setForm(null);
  };

  const saveAgent = async () => { setSaving(true); setNotice(''); try { if(selected.agent_key==='zatca_nightly') await configureZatcaWorkAgent(form); else await configureOverdueSadadAgent(form); setNotice('تم حفظ الشروط وإعادة الجدولة.'); await load(); } catch(e) { setNotice(e?.message || 'تعذر الحفظ'); } finally { setSaving(false); } };
  const previewAgent = async () => { setSaving(true); setNotice(''); try { setPreview(selected.agent_key==='zatca_nightly' ? await previewZatcaWorkAgent() : await previewOverdueSadadAgent()); } catch(e) { setNotice(e?.message || 'تعذرت المعاينة'); } finally { setSaving(false); } };
  const runAgent = async () => { if (!preview) return; const isZatca=selected.agent_key==='zatca_nightly'; const count=isZatca?preview.count:preview.total; if (!window.confirm(isZatca?`سيتم إرسال ${count} فاتورة إلى زاتكا عبر Zoho الآن. هل تعتمد التنفيذ؟`:`سيتم تجهيز ${count} رسالة بقالب sadad للإرسال الآن. هل تعتمد التشغيل؟`)) return; setSaving(true); try { const r=isZatca?await runZatcaWorkAgent():await runOverdueSadadAgent(); setNotice(isZatca?`اكتمل التشغيل: أُرسلت ${r.pushed||0}، وتجاوز ${r.skipped||0}، وفشل ${r.failed||0}.`:`تمت جدولة ${r.queued} رسالة، ويعالجها هاتف الآن.`); await load(); } catch(e) { setNotice(e?.message || 'تعذر التشغيل'); } finally { setSaving(false); } };

  const load = useCallback(async () => {
    if (!isActive) return;
    setLoading(true); setError('');
    try {
      const [agentRows, runRows] = await Promise.all([loadWorkAgents(), loadRecentAgentRuns()]);
      setAgents(agentRows); setRuns(runRows);
    } catch (e) {
      setError(e?.message || 'تعذر تحميل وكلاء العمل');
    } finally { setLoading(false); }
  }, [isActive]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!selected) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [selected]);

  const totals = useMemo(() => ({
    active: agents.filter(a => a.status === 'active').length,
    draft: agents.filter(a => a.status === 'draft').length,
    attention: agents.filter(a => a.status === 'error').length,
  }), [agents]);

  if (!can('agents.view')) return null;
  return (
    <div style={{ padding: '24px clamp(16px,3vw,32px) 110px', maxWidth: 1440, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'var(--accent)', fontWeight: 800, fontSize: 12, marginBottom: 7 }}><Sparkles size={17}/> مركز الأتمتة السحابية</div>
          <h1 style={{ margin: 0, color: 'var(--text)', fontSize: 'clamp(24px,4vw,34px)' }}>وكلاء العمل</h1>
          <p style={{ margin: '8px 0 0', color: 'var(--muted)', lineHeight: 1.8, maxWidth: 760 }}>مهام يومية وأسبوعية وشهرية تعمل على الخادم دون إبقاء جهازك مفتوحًا. التنفيذ المالي الحساس يبقى خلف الموافقة والصلاحيات.</p>
        </div>
        <Btn variant="ghost" size="sm" onClick={load} icon={<RefreshCw size={16}/>}>تحديث حالة الوكلاء</Btn>
      </header>

      <div className="work-agents-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 12, marginBottom: 20 }}>
        {[
          ['إجمالي الوكلاء', agents.length, Bot, 'var(--accent)'],
          ['يعمل الآن', totals.active, CheckCircle2, 'var(--green)'],
          ['قيد التأسيس', totals.draft, Clock3, 'var(--muted)'],
          ['يحتاج تدخلًا', totals.attention, ShieldCheck, 'var(--red)'],
        ].map(([label, value, Icon, color]) => <Card key={label} style={{ padding: 16 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><div><div style={{ color: 'var(--muted)', fontSize: 12 }}>{label}</div><strong style={{ display: 'block', marginTop: 8, fontSize: 25, color: 'var(--text)' }}>{value}</strong></div><Icon size={20} color={color}/></div></Card>)}
      </div>

      {loading ? <div style={{ padding: 60, textAlign: 'center' }}><Spinner/></div> : error ? (
        <Card accent="var(--red)"><strong style={{ color: 'var(--red)' }}>تعذر فتح مركز الوكلاء</strong><p style={{ color: 'var(--muted)', marginBottom: 0 }}>{error}</p></Card>
      ) : (
        <div className="work-agents-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 16 }}>
          {agents.map(agent => <AgentCard key={agent.id || agent.agent_key} agent={agent} onStart={openAgent}/>) }
        </div>
      )}

      <Card style={{ marginTop: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}><Database size={19} color="var(--accent)"/><strong>سجل التشغيل</strong></div>
        {runs.length === 0 ? <p style={{ margin: 0, color: 'var(--muted)', lineHeight: 1.8 }}>لا توجد عمليات تشغيل بعد. سيظهر هنا وقت التشغيل، وعدد السجلات المفحوصة، والإجراءات المنفذة، والأخطاء.</p> : runs.map(run => <div key={run.id}>{run.summary || run.status}</div>)}
      </Card>

      {selected && <div className="work-agent-dialog-backdrop" role="dialog" aria-modal="true" aria-label="تأسيس وكيل العمل" onClick={() => setSelected(null)}>
        <Card className="work-agent-dialog-card" onClick={e => e.stopPropagation()}>
          <StatusPill status={selected.status}/>
          <h2 style={{ margin: '14px 0 8px' }}>{selected.name}</h2>
          <p style={{ color: 'var(--text2)', lineHeight: 1.8 }}>{selected.description}</p>
          {selected.agent_key === 'overdue_sadad' && form ? <>
            <div style={{ padding: 14, borderRadius: 12, background: 'var(--surface2)', color: 'var(--text2)', lineHeight: 1.8, fontSize: 13 }}><b>الإجراء:</b> قراءة فواتير زوهو فقط، ربطها بدليل المتاجر، ثم إرسال قالب <b>sadad</b> عبر هاتف. لا ينشئ عملاء ولا يعدّل زوهو.</div>
            <label className="agent-toggle"><input type="checkbox" checked={form.enabled} onChange={e=>setForm({...form,enabled:e.target.checked})}/><span><b>تشغيل الجدول الأسبوعي</b><small>{form.enabled?'الوكيل سيعمل تلقائيًا':'لن يحدث إرسال مجدول'}</small></span></label>
            <div className="agent-form-grid">
              <label>اليوم<select value={form.dayOfWeek} onChange={e=>setForm({...form,dayOfWeek:e.target.value})}>{['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'].map((x,i)=><option key={i} value={i}>{x}</option>)}</select></label>
              <label>الوقت<input type="time" value={`${String(form.hour).padStart(2,'0')}:${String(form.minute).padStart(2,'0')}`} onChange={e=>{const [hour,minute]=e.target.value.split(':').map(Number);setForm({...form,hour,minute});}}/></label>
              <label>التأخير أكثر من (يوم)<input type="number" min="1" max="3650" value={form.minDays} onChange={e=>setForm({...form,minDays:e.target.value})}/></label>
              <label>أقل رصيد مستحق<input type="number" min="0" step="0.01" value={form.minBalance} onChange={e=>setForm({...form,minBalance:e.target.value})}/></label>
              <label>حد المستلمين في التشغيل<input type="number" min="1" max="2000" value={form.maxRecipients} onChange={e=>setForm({...form,maxRecipients:e.target.value})}/></label>
            </div>
            {preview && <div style={{padding:14,border:'1px solid var(--green)',borderRadius:12,background:'var(--green-soft)',lineHeight:1.8}}><b>نتيجة المعاينة: {preview.total} متجر</b><br/>إجمالي المستحق: {Number(preview.total_owed||0).toLocaleString('en-US',{maximumFractionDigits:2})} ر.س · بلا هاتف: {preview.missing_phone}</div>}
            {notice && <div style={{color:notice.includes('تعذر')?'var(--red)':'var(--green)',fontWeight:700}}>{notice}</div>}
            <div style={{ display: 'flex', flexWrap:'wrap', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}><Btn variant="ghost" onClick={() => setSelected(null)}>إغلاق</Btn><Btn variant="ghost" disabled={saving} onClick={previewAgent}>معاينة المستحقين</Btn>{can('agents.run')&&<Btn variant="accent" disabled={saving||!preview?.total} onClick={runAgent}>تشغيل وإرسال الآن</Btn>}<Btn variant="primary" disabled={saving||!can('agents.manage')} onClick={saveAgent}>حفظ وإعادة الجدولة</Btn></div>
          </> : selected.agent_key === 'zatca_nightly' && form ? <>
            <div style={{ padding: 14, borderRadius: 12, background: 'var(--surface2)', color: 'var(--text2)', lineHeight: 1.8, fontSize: 13 }}><b>الإجراء:</b> يفحص الحالة الحية لكل فاتورة في Zoho، ثم يرسل الجاهزة إلى زاتكا من خلال تكامل Zoho. الأرصدة الافتتاحية مستبعدة دائمًا.</div>
            <label className="agent-toggle"><input type="checkbox" checked={form.enabled} onChange={e=>setForm({...form,enabled:e.target.checked})}/><span><b>تشغيل الفحص الليلي</b><small>{form.enabled?'سيعمل يوميًا حسب الوقت المحدد':'لن يحدث إرسال تلقائي'}</small></span></label>
            <div className="agent-form-grid">
              <label>وقت التشغيل<input type="time" value={`${String(form.hour).padStart(2,'0')}:${String(form.minute).padStart(2,'0')}`} onChange={e=>{const [hour,minute]=e.target.value.split(':').map(Number);setForm({...form,hour,minute});}}/></label>
              <label>أقصى عدد فواتير في الدورة<input type="number" min="1" max="500" value={form.maxInvoices} onChange={e=>setForm({...form,maxInvoices:e.target.value})}/></label>
            </div>
            {preview && <div style={{padding:14,border:'1px solid var(--gold)',borderRadius:12,background:'var(--gold-soft)',lineHeight:1.8}}><b>نتيجة المعاينة: {preview.count} فاتورة جاهزة</b><br/>مستبعد للمراجعة اليدوية: {preview.excludedCount||0}</div>}
            {notice && <div style={{color:notice.includes('تعذر')||notice.includes('فشل')?'var(--red)':'var(--green)',fontWeight:700}}>{notice}</div>}
            <div style={{ display:'flex',flexWrap:'wrap',justifyContent:'flex-end',gap:10,marginTop:20 }}><Btn variant="ghost" onClick={()=>setSelected(null)}>إغلاق</Btn><Btn variant="ghost" disabled={saving} onClick={previewAgent}>معاينة فواتير زاتكا</Btn>{can('agents.approve_sensitive')&&<Btn variant="accent" disabled={saving||!preview?.count} onClick={runAgent}>اعتماد الإرسال الآن</Btn>}<Btn variant="primary" disabled={saving||!can('agents.manage')} onClick={saveAgent}>حفظ وإعادة الجدولة</Btn></div>
          </> : <><div style={{ padding: 14, borderRadius: 12, background: 'var(--surface2)', color: 'var(--text2)', lineHeight: 1.8, fontSize: 13 }}><b>الحالة:</b> هذا الوكيل ما زال قيد التأسيس ولن ينفذ أي إجراء.</div><div style={{display:'flex',justifyContent:'flex-end',marginTop:20}}><Btn variant="ghost" onClick={() => setSelected(null)}>إغلاق</Btn></div></>}
        </Card>
      </div>}

      <style>{`.work-agent-dialog-backdrop{position:fixed;inset:0;z-index:1200;background:rgba(15,23,42,.58);display:grid;place-items:center;padding:16px;overscroll-behavior:contain}.work-agent-dialog-card{width:min(560px,100%);max-height:calc(100dvh - 32px);overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:24px!important}.agent-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}.agent-form-grid label{display:grid;gap:6px;font-size:12px;font-weight:800;color:var(--text2)}.agent-form-grid input,.agent-form-grid select{min-height:44px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);padding:8px 10px;font:inherit}.agent-toggle{display:flex;align-items:center;gap:10px;margin-top:14px;padding:12px;border:1px solid var(--border2);border-radius:12px}.agent-toggle span{display:grid;gap:3px}.agent-toggle small{color:var(--muted)} @media(max-width:1000px){.work-agents-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}} @media(max-width:680px){.work-agents-grid,.work-agents-stats,.agent-form-grid{grid-template-columns:1fr!important}.work-agent-dialog-backdrop{place-items:end center;padding:10px 10px calc(10px + env(safe-area-inset-bottom))}.work-agent-dialog-card{width:100%;max-height:calc(100dvh - 86px);padding:18px 16px calc(24px + env(safe-area-inset-bottom))!important;border-radius:18px 18px 14px 14px!important}}`}</style>
    </div>
  );
}
