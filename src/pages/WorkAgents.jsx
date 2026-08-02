import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, CalendarClock, CheckCircle2, Clock3, Database, PlayCircle, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { Btn, Card, Spinner } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadRecentAgentRuns, loadWorkAgents } from '../lib/workAgentService.js';

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
          {agents.map(agent => <AgentCard key={agent.id || agent.agent_key} agent={agent} onStart={setSelected}/>) }
        </div>
      )}

      <Card style={{ marginTop: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}><Database size={19} color="var(--accent)"/><strong>سجل التشغيل</strong></div>
        {runs.length === 0 ? <p style={{ margin: 0, color: 'var(--muted)', lineHeight: 1.8 }}>لا توجد عمليات تشغيل بعد. سيظهر هنا وقت التشغيل، وعدد السجلات المفحوصة، والإجراءات المنفذة، والأخطاء.</p> : runs.map(run => <div key={run.id}>{run.summary || run.status}</div>)}
      </Card>

      {selected && <div role="dialog" aria-modal="true" aria-label="تأسيس وكيل العمل" onClick={() => setSelected(null)} style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(15,23,42,.58)', display: 'grid', placeItems: 'center', padding: 16 }}>
        <Card onClick={e => e.stopPropagation()} style={{ width: 'min(560px,100%)', padding: 24 }}>
          <StatusPill status={selected.status}/>
          <h2 style={{ margin: '14px 0 8px' }}>{selected.name}</h2>
          <p style={{ color: 'var(--text2)', lineHeight: 1.8 }}>{selected.description}</p>
          <div style={{ padding: 14, borderRadius: 12, background: 'var(--surface2)', color: 'var(--text2)', lineHeight: 1.8, fontSize: 13 }}><b>الخطوة التالية:</b> سنعرّف شروط هذا الوكيل، الإجراء المسموح، المسؤول عن الاعتماد، ثم نختبره بوضع المعاينة قبل تشغيل الجدول السحابي.</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}><Btn variant="ghost" onClick={() => setSelected(null)}>إغلاق</Btn><Btn variant="accent" disabled>التفعيل بعد اكتمال الإعداد</Btn></div>
        </Card>
      </div>}

      <style>{`@media(max-width:1000px){.work-agents-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}} @media(max-width:680px){.work-agents-grid,.work-agents-stats{grid-template-columns:1fr!important}}`}</style>
    </div>
  );
}
