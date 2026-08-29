import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CheckCircle2, MessageCircle, PhoneCall } from 'lucide-react';
import { Btn, Modal, Spinner } from './UI.jsx';
import { loadCampaignStats } from '../lib/whatsappService.js';
import { ivrStatusBadge, loadIvrCalls } from '../lib/ivrService.js';

const fmt0 = value => Number(value || 0).toLocaleString('en-US');
const pct = (value, total) => total ? `${Math.round((Number(value || 0) / total) * 100)}%` : '0%';
const STATUS_LABELS = {
  draft: 'مسودة', review: 'تحت المراجعة', ready: 'جاهزة', scheduled: 'مجدولة',
  running: 'تعمل الآن', completed: 'مكتملة', needs_decision: 'تحتاج قرارًا', cancelled: 'ملغاة',
};

const reasonAr = reason => /undeliverable/i.test(reason) ? 'الرقم بلا واتساب'
  : /healthy ecosystem/i.test(reason) ? 'خنق جودة من ميتا'
  : /experiment/i.test(reason) ? 'تجربة ميتا مؤقتة'
  : /chosen to stop receiving marketing messages|stop receiving marketing/i.test(reason) ? 'المستلم أوقف الرسائل التسويقية'
  : /document format|not supported by whatsapp|supported formats/i.test(reason) ? 'صيغة المرفق غير مدعومة'
  : /invalid|not.*valid/i.test(reason) ? 'رقم غير صالح'
  : reason;

const relativeTime = value => {
  if (!value) return '—';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `قبل ${minutes} دقيقة`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `قبل ${hours} ساعة` : `قبل ${Math.round(hours / 24)} يوم`;
};

function Metric({ label, value, sub, tone = 'var(--text)' }) {
  return <div className="campaign-result-metric"><span>{label}</span><b style={{ color: tone }}>{fmt0(value)}</b>{sub ? <small>{sub}</small> : null}</div>;
}

function WhatsAppResult({ name }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const result = await loadCampaignStats(name);
        if (alive) { setState(result); setError(''); }
      } catch (err) { if (alive) setError(err?.message || 'تعذّر تحديث الحملة'); }
    };
    pull();
    const timer = setInterval(pull, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [name]);

  if (!state) return <div className="campaign-result-loading"><Spinner/>{error || 'يحمّل النتيجة الحية…'}</div>;
  const metrics = [
    ['المستهدفون', state.targets, null, 'var(--text)'],
    ['وصلت', state.delivered, pct(state.delivered, state.targets), 'var(--accent3)'],
    ['قُرئت', state.read, pct(state.read, state.targets), 'var(--green)'],
    ['ردّوا', state.replied, state.botReplies ? `+${fmt0(state.botReplies)} آلي` : null, 'var(--brand)'],
    ['أُسندت', state.assigned, null, 'var(--accent)'],
    ['فشل', state.failed, pct(state.failed, state.targets), 'var(--red)'],
    ['قيد الإرسال', state.pending, null, 'var(--muted)'],
  ];
  return <>
    <div className="campaign-result-live"><span className="live-dot"/>تحديث حي كل 5 ثوانٍ <span>· آخر حدث {relativeTime(state.lastEvent)}</span><b>{state.template || 'القالب غير متاح'}</b></div>
    <div className="campaign-result-metrics">{metrics.map(([label, value, sub, tone]) => <Metric key={label} label={label} value={value} sub={sub} tone={tone}/>)}</div>
    {!!state.failReasons?.length && <section className="campaign-result-section"><h3>أسباب الفشل</h3>{state.failReasons.map((row, index) => <div className="campaign-result-reason" key={`${row.reason}-${index}`}><b>{fmt0(row.n)}</b><span>{reasonAr(row.reason)}</span></div>)}</section>}
    <section className="campaign-result-section"><h3>آخر الأحداث</h3>{state.recent?.length ? <div className="campaign-result-events">{state.recent.map((event, index) => <div key={`${event.phone}-${event.at}-${index}`}><span>{event.name || event.phone}</span><b>{event.kind}</b><small>{relativeTime(event.at)}</small></div>)}</div> : <p>لا توجد أحداث حديثة.</p>}</section>
  </>;
}

function IvrResult({ name }) {
  const [calls, setCalls] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const rows = await loadIvrCalls({ campaign: name, limit: 500 });
        if (alive) { setCalls(rows); setError(''); }
      } catch (err) { if (alive) setError(err?.message || 'تعذّر تحديث المكالمات'); }
    };
    pull();
    const timer = setInterval(pull, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [name]);
  const summary = useMemo(() => {
    if (!calls) return null;
    return calls.reduce((acc, row) => {
      const answered = Boolean(row.answered_at) || Number(row.duration_seconds) > 0;
      acc.total += 1;
      if (answered) acc.answered += 1;
      if (row.pressed_digit) acc.pressed += 1;
      if (!answered && ['3', '4', 'Failed'].includes(String(row.status))) acc.failed += 1;
      return acc;
    }, { total: 0, answered: 0, pressed: 0, failed: 0 });
  }, [calls]);
  if (!summary) return <div className="campaign-result-loading"><Spinner/>{error || 'يحمّل نتيجة المكالمات…'}</div>;
  return <>
    <div className="campaign-result-live"><span className="live-dot"/>تحديث حي كل 5 ثوانٍ <span>· {fmt0(summary.total)} مكالمة مسجلة</span></div>
    <div className="campaign-result-metrics is-ivr">
      <Metric label="المكالمات" value={summary.total}/>
      <Metric label="تم الرد" value={summary.answered} sub={pct(summary.answered, summary.total)} tone="var(--green)"/>
      <Metric label="تفاعل بالضغط" value={summary.pressed} sub={pct(summary.pressed, summary.total)} tone="var(--brand)"/>
      <Metric label="لم تُجب/فشلت" value={summary.failed} tone="var(--red)"/>
    </div>
    <section className="campaign-result-section"><h3>آخر المكالمات</h3>{calls.length ? <div className="campaign-result-events">{calls.slice(0, 12).map((call, index) => { const status = ivrStatusBadge(call); return <div key={call.id || `${call.phone}-${index}`}><span>{call.name || call.phone}</span><b style={{ color: status.c }}>{status.t}</b><small>{relativeTime(call.created_at)}</small></div>; })}</div> : <p>لا توجد مكالمات مسجلة لهذه الحملة بعد.</p>}</section>
  </>;
}

export default function CampaignResultModal({ campaign, onClose, onEdit, onShowMessages, onShowIvrLog }) {
  if (!campaign) return null;
  const channel = campaign.channel || 'whatsapp';
  const isWhatsApp = channel === 'whatsapp' || campaign.legacy;
  const isIvr = channel === 'ivr';
  return <Modal title={`نتيجة الحملة — ${campaign.name}`} onClose={onClose} width={780}>
    <div className="campaign-result-context">
      <span>{isIvr ? <PhoneCall size={15}/> : <MessageCircle size={15}/>} {isIvr ? 'IVR' : isWhatsApp ? 'WhatsApp عبر هاتف' : 'قناة تشغيلية'}</span>
      <span>{campaign.readyCount || campaign.resultSummary?.targets || 0} مستهدف</span>
      {campaign.financialAmount ? <span>{Number(campaign.financialAmount).toLocaleString('en-US', { maximumFractionDigits: 2 })} ر.س</span> : null}
      <span>الحالة: {STATUS_LABELS[campaign.status] || (campaign.legacy ? 'سجل تاريخي' : campaign.status || 'غير محددة')}</span>
    </div>
    {isWhatsApp ? <WhatsAppResult name={campaign.name}/> : isIvr ? <IvrResult name={campaign.name}/> : <div className="campaign-result-empty"><CheckCircle2 size={22}/><b>النتيجة التشغيلية</b><span>{campaign.resultSummary?.tasks != null ? `${fmt0(campaign.resultSummary.tasks)} مهمة` : campaign.resultSummary?.exported != null ? `${fmt0(campaign.resultSummary.exported)} مستلم تم تصديره` : 'لا توجد أحداث قناة قابلة للعرض.'}</span></div>}
    <div className="campaign-result-actions">
      {isWhatsApp && onShowMessages ? <Btn size="sm" variant="accent" icon={<BarChart3 size={14}/>} onClick={onShowMessages}>سجل الرسائل الكامل</Btn> : null}
      {isIvr && onShowIvrLog ? <Btn size="sm" variant="accent" icon={<PhoneCall size={14}/>} onClick={onShowIvrLog}>سجل المكالمات الكامل</Btn> : null}
      {!campaign.legacy && onEdit ? <Btn size="sm" variant="ghost" onClick={onEdit}>تعديل الإعدادات</Btn> : null}
      <Btn size="sm" variant="ghost" onClick={onClose}>إغلاق</Btn>
    </div>
  </Modal>;
}
