import { useMemo, useState, useEffect } from 'react';
import {
  Scale, RefreshCw, MessageCircle, Download, AlertTriangle, FileText,
  CalendarClock, UserRound, Building2, Plus, Clock3, Gavel, ExternalLink, Save,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { persistAndDownloadExport } from '../lib/internalExportsService.js';
import { Card, Btn, Spinner, Empty, toast, PageHeader, Modal, Input, Select } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  loadLegalDashboard, loadLegalCases, createLegalCase, updateLegalCase, addLegalCaseEvent,
} from '../lib/legalService.js';
import WaActions from '../components/WaActions.jsx';
import WhatsAppSendModal from '../components/WhatsAppSendModal.jsx';
import { normalizeSaudiPhone } from '../lib/whatsappService.js';
import './legal-escalation.css';

const fmt = (n) => (n == null || Number.isNaN(Number(n))) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const daysSince = (d) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000) : '';
const dateLabel = (d, withTime = true) => d ? new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
  year: 'numeric', month: 'short', day: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
}).format(new Date(d)) : 'غير محدد';
const toInputDateTime = (d) => {
  if (!d) return '';
  const x = new Date(d);
  const shifted = new Date(x.getTime() - x.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
};

const STAGES = {
  review: 'تقييم قانوني', notice: 'إنذار ومطالبة', filed: 'تم رفع الدعوى', hearing: 'جلسات ومرافعات',
  judgment: 'صدر حكم', settlement: 'تسوية', closed: 'مغلق',
};
const STATUSES = {
  open: 'مفتوح', on_hold: 'معلّق', settled: 'تمت التسوية', won: 'حكم لصالحنا', lost: 'حكم ضدنا', closed: 'مغلق',
};
const EVENT_TYPES = {
  review: 'مراجعة قانونية', notice: 'إنذار أو مطالبة', contact: 'تواصل قانوني', filed: 'رفع دعوى',
  hearing: 'جلسة', judgment: 'حكم', settlement: 'تسوية', payment: 'سداد', document: 'مستند',
  note: 'ملاحظة', status_change: 'تغيير حالة',
};
const isClosed = (status) => ['settled', 'won', 'lost', 'closed'].includes(status);

function sourceKeyForCandidate(kind, row) {
  if (kind === 'negative_wallet') return `store:${row.storeId || row.phone || row.storeName}`;
  return `zoho:${row.phone || row.name || row.storeName}`;
}

function PhoneCell({ phone, name, amount, count }) {
  if (!phone) return <span className="legal-muted">لا هاتف</span>;
  return <WaActions phone={phone} name={name} amount={amount} count={count}
    vars={[name || '', fmt(amount), String(count ?? '')]} campaignLabel="التصعيد القانوني" size={14}/>;
}

function TargetCard({ label, actual, target, zeroTarget }) {
  const over = zeroTarget ? actual > 0.5 : actual > target + 0.5;
  const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : (actual > 0.5 ? 100 : 0);
  return (
    <div className={`legal-target ${over ? 'is-over' : 'is-safe'}`}>
      <span>{label}</span><strong>{fmt0(actual)}</strong>
      <small>الهدف: {zeroTarget ? 'صفر ر.س' : `≤ ${fmt0(target)} ر.س`} · {over ? 'متجاوز' : 'ضمن الهدف'}</small>
      <i><b style={{ width: `${pct}%` }}/></i>
    </div>
  );
}

function LegalSummary({ cases }) {
  const open = cases.filter(c => !isClosed(c.status));
  const overdue = open.filter(c => c.nextActionAt && new Date(c.nextActionAt) < new Date());
  const hearings = open.filter(c => c.stage === 'hearing');
  const exposed = open.reduce((sum, c) => sum + c.claimAmount, 0);
  return (
    <div className="legal-kpis">
      <div><FileText/><span>ملفات مفتوحة</span><strong>{open.length}</strong></div>
      <div className={overdue.length ? 'danger' : ''}><CalendarClock/><span>مواعيد متأخرة</span><strong>{overdue.length}</strong></div>
      <div><Gavel/><span>في مرحلة الجلسات</span><strong>{hearings.length}</strong></div>
      <div><Scale/><span>قيمة المطالبات المفتوحة</span><strong>{fmt(exposed)} <small>ر.س</small></strong></div>
    </div>
  );
}

function CaseList({ cases, onOpen }) {
  const rows = [...cases].sort((a, b) => {
    const ac = isClosed(a.status) ? 1 : 0; const bc = isClosed(b.status) ? 1 : 0;
    if (ac !== bc) return ac - bc;
    return new Date(a.nextActionAt || '2999-01-01') - new Date(b.nextActionAt || '2999-01-01');
  });
  if (!rows.length) return <Card><Empty icon={<FileText/>} title="لا توجد ملفات قانونية مسجلة" sub="الحالات أدناه مرشحة فقط، ولن تصبح قضية إلا بعد فتح ملف قانوني."/></Card>;
  return (
    <Card className="legal-case-list">
      {rows.map(c => {
        const last = c.events[0];
        const late = !isClosed(c.status) && c.nextActionAt && new Date(c.nextActionAt) < new Date();
        return <button type="button" key={c.id} onClick={() => onOpen(c)} className="legal-case-row">
          <div className="legal-case-main">
            <span className={`legal-state ${isClosed(c.status) ? 'closed' : late ? 'late' : 'open'}`}>{STATUSES[c.status] || c.status}</span>
            <strong>{c.customerName}</strong>
            <small>{c.caseNumber ? `رقم القضية ${c.caseNumber}` : 'لم يسجل رقم قضية'} · {STAGES[c.stage] || c.stage}</small>
          </div>
          <div><span>المطالبة</span><strong>{fmt(c.claimAmount)} ر.س</strong></div>
          <div><span>{late ? 'موعد متأخر' : 'الموعد القادم'}</span><strong className={late ? 'danger-text' : ''}>{dateLabel(c.nextActionAt)}</strong></div>
          <div><span>آخر إجراء</span><strong>{last?.title || 'فتح الملف فقط'}</strong><small>{last ? dateLabel(last.occurredAt) : dateLabel(c.openedAt)}</small></div>
          <span className="legal-row-arrow">‹</span>
        </button>;
      })}
    </Card>
  );
}

function CaseWorkspace({ value, canManage, onClose, onChanged, userId }) {
  const [item, setItem] = useState(value);
  const [busy, setBusy] = useState(false);
  const [event, setEvent] = useState({
    eventType: 'notice', occurredAt: toInputDateTime(new Date()), title: '', details: '', outcome: '',
    nextActionAt: '', documentName: '', documentUrl: '',
  });
  const update = (key, val) => setItem(p => ({ ...p, [key]: val }));

  const saveCase = async () => {
    setBusy(true);
    try {
      const saved = await updateLegalCase(item.id, {
        ...item, nextActionAt: item.nextActionAt ? new Date(item.nextActionAt).toISOString() : null,
      });
      setItem(p => ({ ...p, ...saved, events: p.events }));
      onChanged(); toast('حُفظت بيانات الملف القانوني', 'success');
    } catch (e) { toast(`تعذر حفظ الملف: ${e.message}`, 'error'); }
    setBusy(false);
  };

  const addEvent = async () => {
    if (!event.title.trim()) { toast('اكتب اسم الإجراء القانوني', 'error'); return; }
    setBusy(true);
    try {
      const saved = await addLegalCaseEvent(item.id, {
        ...event,
        occurredAt: event.occurredAt ? new Date(event.occurredAt).toISOString() : new Date().toISOString(),
        nextActionAt: event.nextActionAt ? new Date(event.nextActionAt).toISOString() : null,
      }, userId);
      setItem(p => ({ ...p, events: [saved, ...p.events] }));
      setEvent({ eventType: 'notice', occurredAt: toInputDateTime(new Date()), title: '', details: '', outcome: '', nextActionAt: '', documentName: '', documentUrl: '' });
      onChanged(); toast('سُجل الإجراء في التسلسل الزمني', 'success');
    } catch (e) { toast(`تعذر تسجيل الإجراء: ${e.message}`, 'error'); }
    setBusy(false);
  };

  return <Modal title={`الملف القانوني — ${item.customerName}`} onClose={onClose} width={940} className="legal-case-modal">
    <div className="legal-source-note">
      <Scale size={18}/><div><strong>قيمة المطالبة لقطة مرجعية: {fmt(item.claimAmount)} ر.س</strong>
      <span>إجراءات الملف لا تعدّل رصيد العميل أو فواتير Zoho أو محفظة لمحة.</span></div>
    </div>
    <div className="legal-case-grid">
      <section className="legal-case-form">
        <h4>بيانات القضية والمتابعة</h4>
        <div className="legal-form-grid">
          <Select label="المرحلة" value={item.stage} disabled={!canManage} onChange={e => update('stage', e.target.value)}>{Object.entries(STAGES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Select label="الحالة" value={item.status} disabled={!canManage} onChange={e => update('status', e.target.value)}>{Object.entries(STATUSES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Input label="رقم القضية/المعاملة" value={item.caseNumber} disabled={!canManage} onChange={e => update('caseNumber', e.target.value)}/>
          <Input label="الجهة أو المحكمة" value={item.authority} disabled={!canManage} onChange={e => update('authority', e.target.value)}/>
          <Input label="المسؤول عن الملف" value={item.ownerName} disabled={!canManage} onChange={e => update('ownerName', e.target.value)}/>
          <Input label="موعد الإجراء القادم" type="datetime-local" value={toInputDateTime(item.nextActionAt)} disabled={!canManage} onChange={e => update('nextActionAt', e.target.value)}/>
          <Input label="الإجراء القادم" value={item.nextAction} disabled={!canManage} onChange={e => update('nextAction', e.target.value)} style={{ gridColumn: '1 / -1' }}/>
          <Input label="النتيجة الحالية" value={item.result} disabled={!canManage} onChange={e => update('result', e.target.value)} style={{ gridColumn: '1 / -1' }}/>
          <label className="legal-textarea"><span>ملاحظات الملف</span><textarea value={item.notes} disabled={!canManage} onChange={e => update('notes', e.target.value)} rows={3}/></label>
        </div>
        {canManage && <Btn icon={<Save size={14}/>} onClick={saveCase} disabled={busy}>حفظ بيانات القضية</Btn>}

        {canManage && <div className="legal-new-event">
          <h4>تسجيل إجراء قانوني جديد</h4>
          <div className="legal-form-grid">
            <Select label="نوع الإجراء" value={event.eventType} onChange={e => setEvent(p => ({ ...p, eventType: e.target.value }))}>{Object.entries(EVENT_TYPES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</Select>
            <Input label="تاريخ ووقت الإجراء" type="datetime-local" value={event.occurredAt} onChange={e => setEvent(p => ({ ...p, occurredAt: e.target.value }))}/>
            <Input label="اسم الإجراء" placeholder="مثال: إرسال إنذار رسمي" value={event.title} onChange={e => setEvent(p => ({ ...p, title: e.target.value }))} style={{ gridColumn: '1 / -1' }}/>
            <label className="legal-textarea"><span>التفاصيل</span><textarea value={event.details} onChange={e => setEvent(p => ({ ...p, details: e.target.value }))} rows={3}/></label>
            <Input label="النتيجة" value={event.outcome} onChange={e => setEvent(p => ({ ...p, outcome: e.target.value }))}/>
            <Input label="الموعد التالي الناتج عن الإجراء" type="datetime-local" value={event.nextActionAt} onChange={e => setEvent(p => ({ ...p, nextActionAt: e.target.value }))}/>
            <Input label="اسم المستند (اختياري)" value={event.documentName} onChange={e => setEvent(p => ({ ...p, documentName: e.target.value }))}/>
            <Input label="رابط المستند (اختياري)" type="url" value={event.documentUrl} onChange={e => setEvent(p => ({ ...p, documentUrl: e.target.value }))}/>
          </div>
          <Btn icon={<Plus size={14}/>} onClick={addEvent} disabled={busy}>إضافة الإجراء للسجل</Btn>
        </div>}
      </section>
      <section className="legal-timeline">
        <h4>التسلسل الزمني الكامل</h4>
        <div className="legal-opening"><Clock3/><div><strong>فتح الملف القانوني</strong><span>{dateLabel(item.openedAt)}</span></div></div>
        {item.events.map(e => <article key={e.id}>
          <i/><div className="legal-event-head"><span>{EVENT_TYPES[e.eventType] || e.eventType}</span><time>{dateLabel(e.occurredAt)}</time></div>
          <strong>{e.title}</strong>{e.details && <p>{e.details}</p>}
          {e.outcome && <div className="legal-outcome">النتيجة: {e.outcome}</div>}
          {e.nextActionAt && <div className="legal-next">الموعد التالي: {dateLabel(e.nextActionAt)}</div>}
          {e.documentUrl && <a href={e.documentUrl} target="_blank" rel="noreferrer"><ExternalLink size={12}/>{e.documentName || 'فتح المستند'}</a>}
        </article>)}
        {!item.events.length && <Empty icon={<Clock3/>} title="لم يسجل أي إجراء بعد" sub="أضف الإنذار، التواصل، الجلسة، الحكم أو التسوية مع التاريخ والنتيجة."/>}
      </section>
    </div>
  </Modal>;
}

export default function LegalEscalation({ isActive = true }) {
  const { can, user, profile } = useAuth();
  const [d, setD] = useState(null);
  const [cases, setCases] = useState([]);
  const [caseError, setCaseError] = useState('');
  const [selectedCase, setSelectedCase] = useState(null);
  const [busy, setBusy] = useState(false);
  const [walletWaOpen, setWalletWaOpen] = useState(false);
  const canManage = can('legal.manage');

  const walletRecipients = (d?.prepaidNegative || []).filter(r => r.phone).map(r => {
    const amount = Math.abs(Number(r.wallet) || 0);
    return { to: normalizeSaudiPhone(r.phone), name: r.storeName, amount, vars: [r.storeName || '', fmt(amount), ''], fields: { name: r.storeName, amount } };
  });

  const refresh = async () => {
    setBusy(true); setCaseError('');
    const [dashboardResult, caseResult] = await Promise.allSettled([loadLegalDashboard(), loadLegalCases()]);
    if (dashboardResult.status === 'fulfilled') setD(dashboardResult.value);
    else { toast(`فشل تحميل الأرقام: ${dashboardResult.reason?.message || 'خطأ غير معروف'}`, 'error'); setD(p => p || { aging: {}, overdue90: [], prepaidNegative: [] }); }
    if (caseResult.status === 'fulfilled') setCases(caseResult.value);
    else setCaseError(caseResult.reason?.message || 'تعذر قراءة سجل الملفات القانونية');
    setBusy(false);
  };
  useEffect(() => { if (isActive && d == null) refresh(); }, [isActive]); // eslint-disable-line

  const caseBySource = useMemo(() => new Map(cases.filter(c => !isClosed(c.status)).map(c => [`${c.sourceKind}:${c.sourceKey}`, c])), [cases]);
  const getCase = (kind, row) => caseBySource.get(`${kind}:${sourceKeyForCandidate(kind, row)}`);

  const openCandidate = async (kind, row) => {
    const existing = getCase(kind, row);
    if (existing) { setSelectedCase(existing); return; }
    if (!canManage) { toast('تحتاج صلاحية «إدارة الملفات القانونية» لفتح ملف جديد', 'error'); return; }
    setBusy(true);
    try {
      const created = await createLegalCase({
        sourceKind: kind, sourceKey: sourceKeyForCandidate(kind, row), customerName: row.storeName || row.name,
        storeId: row.storeId, phone: row.phone, claimAmount: kind === 'overdue_90' ? row.totalOpen : Math.abs(row.wallet),
        ownerName: profile?.name || '', nextAction: 'مراجعة المستندات وتحديد الإجراء القانوني', notes: kind === 'overdue_90' ? `أقدم فاتورة: ${row.oldestDays} يوم` : 'رصيد محفظة سالب',
      }, user.id);
      const initial = await addLegalCaseEvent(created.id, { eventType: 'review', title: 'فتح ملف للتقييم القانوني', details: 'تم إنشاء الملف من شاشة مرشحي التصعيد القانوني.' }, user.id);
      const full = { ...created, events: [initial] };
      setCases(p => [full, ...p]); setSelectedCase(full); toast('فُتح ملف قانوني جديد', 'success');
    } catch (e) { toast(`تعذر فتح الملف: ${e.message}`, 'error'); }
    setBusy(false);
  };

  const exportLegal = async () => {
    if (!d) return;
    const wb = XLSX.utils.book_new();
    const caseSheet = [['العميل','قيمة المطالبة','المرحلة','الحالة','رقم القضية','الجهة','المسؤول','الإجراء القادم','الموعد القادم','آخر إجراء','آخر إجراء بتاريخ']];
    cases.forEach(c => caseSheet.push([c.customerName,c.claimAmount,STAGES[c.stage] || c.stage,STATUSES[c.status] || c.status,c.caseNumber,c.authority,c.ownerName,c.nextAction,c.nextActionAt,c.events[0]?.title || '',c.events[0]?.occurredAt || '']));
    const ws0 = XLSX.utils.aoa_to_sheet(caseSheet); ws0['!cols'] = [{wch:34},{wch:14},{wch:18},{wch:16},{wch:18},{wch:22},{wch:20},{wch:32},{wch:20},{wch:32},{wch:20}];
    XLSX.utils.book_append_sheet(wb, ws0, 'الملفات القانونية');
    const s1 = [['مرشحو تجاوز 90 يوماً','','',new Date().toISOString().slice(0,10)],[],['العميل','المتجر','الهاتف','مبلغ +90 يوم','إجمالي المفتوح','أقدم يوم','الفواتير'],...d.overdue90.map(r => [r.name,r.storeName,r.phone,r.amount90,r.totalOpen,r.oldestDays,r.invCnt])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s1), 'مرشحو +90 يوم');
    const s2 = [['مرشحو المحفظة السالبة','','',new Date().toISOString().slice(0,10)],[],['المتجر','رقم المتجر','الهاتف','رصيد المحفظة','الحالة','آخر شحنة'],...d.prepaidNegative.map(r => [r.storeName,r.storeId,r.phone,r.wallet,r.status,r.lastShipmentAt || ''])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s2), 'مرشحو محفظة سالبة');
    try {
      await persistAndDownloadExport({ wb, fileName: `الملفات_القانونية_${new Date().toISOString().slice(0,10)}.xlsx`, kind: 'legal', rowCount: cases.length + d.overdue90.length + d.prepaidNegative.length, userId: user?.id || null });
      toast('صُدّر ملف القانونية وسجل الإجراءات', 'success');
    } catch (e) { toast(`فشل التصدير: ${e.message}`, 'error'); }
  };

  if (!can('legal.view') && !can('receivables.view')) return <div className="legal-denied"><Empty icon={<Scale/>} title="لا صلاحية" sub="تحتاج صلاحية عرض المديونيات أو القانونية"/></div>;
  if (d == null) return <div className="legal-loading"><Spinner size={26}/></div>;
  const ag = d.aging; const totalCandidates = d.overdue90.length + d.prepaidNegative.length;

  return <div className="legal-page">
    <PageHeader icon={<Scale size={22}/>} iconColor="var(--red)" title="التصعيد القانوني" subtitle="ملفات القضايا، الإجراءات المنفذة، المواعيد والنتائج في سجل واحد" actions={<>
      <Btn size="sm" variant="ghost" icon={<Download size={13}/>} onClick={exportLegal}>تصدير السجل</Btn>
      <Btn size="sm" variant="ghost" icon={<RefreshCw size={14} className={busy ? 'spin' : ''}/>} onClick={refresh} disabled={busy}>تحديث البيانات</Btn>
    </>}/>

    <div className="legal-section-heading"><div><span>سجل العمل القانوني</span><h3>الملفات والإجراءات والمواعيد</h3><p>هذه ملفات فعلية موثقة، وليست مجرد ترشيحات آلية.</p></div></div>
    {caseError && <div className="legal-warning"><AlertTriangle/><div><strong>سجل الملفات القانونية غير متاح</strong><span>{caseError}</span></div></div>}
    {!caseError && <><LegalSummary cases={cases}/><CaseList cases={cases} onOpen={setSelectedCase}/></>}

    <div className="legal-section-heading candidates"><div><span>مراقبة آلية</span><h3>مرشحون يحتاجون قرارًا قانونيًا</h3><p>ظهور العميل هنا لا يعني أنه دخل القانونية؛ افتح ملفًا لتوثيق القرار والإجراءات.</p></div><strong>{totalCandidates} حالة</strong></div>
    <div className="legal-target-grid">
      <TargetCard label="31 – 60 يوم" actual={ag.b31_60} target={ag.t31_60}/>
      <TargetCard label="61 – 90 يوم" actual={ag.b61_90} target={ag.t61_90}/>
      <TargetCard label="91 يوم فأكثر" actual={ag.b90plus} target={ag.t90plus} zeroTarget/>
    </div>

    <CandidateSection title="تجاوز 90 يوم" note="فواتير Zoho المفتوحة التي تجاوزت الهدف صفر" count={d.overdue90.length}>
      {d.overdue90.map((r,i) => <div className="legal-candidate" key={`${r.phone || r.name}-${i}`}>
        <div><strong>{r.storeName || r.name}</strong><span>{r.invCnt} فواتير · أقدمها {r.oldestDays} يوم</span></div>
        <div><span>إجمالي المفتوح</span><strong>{fmt(r.totalOpen)} ر.س</strong></div>
        <div><span>منها +90 يوم</span><strong className="danger-text">{fmt(r.amount90)} ر.س</strong></div>
        <PhoneCell phone={r.phone} name={r.storeName || r.name} amount={r.totalOpen} count={r.invCnt}/>
        <Btn size="sm" variant={getCase('overdue_90',r) ? 'ghost' : 'gold'} icon={<FileText size={13}/>} onClick={() => openCandidate('overdue_90',r)} disabled={busy || !!caseError}>{getCase('overdue_90',r) ? 'عرض الملف القانوني' : 'فتح ملف قانوني'}</Btn>
      </div>)}
      {!d.overdue90.length && <Empty icon={<Scale/>} title="لا أحد تجاوز 90 يوم" sub="الهدف محقق حاليًا"/>}
    </CandidateSection>

    <CandidateSection title="دفع مسبق برصيد محفظة سالب" note="متاجر شحنت بأكثر من الرصيد المتاح في المنصة" count={d.prepaidNegative.length} action={can('campaigns.send') && walletRecipients.length ? <Btn size="sm" variant="accent" icon={<MessageCircle size={13}/>} onClick={() => setWalletWaOpen(true)}>حملة مطالبة ({walletRecipients.length})</Btn> : null}>
      {d.prepaidNegative.map((r,i) => <div className="legal-candidate" key={`${r.storeId || r.phone}-${i}`}>
        <div><strong>{r.storeName}</strong><span>{r.storeId ? `متجر #${r.storeId}` : 'رقم المتجر غير متاح'}</span></div>
        <div><span>رصيد المحفظة</span><strong className="danger-text">{fmt(r.wallet)} ر.س</strong></div>
        <div><span>آخر شحنة</span><strong>{r.lastShipmentAt ? dateLabel(r.lastShipmentAt, false) : 'غير متاح'}</strong></div>
        <PhoneCell phone={r.phone} name={r.storeName} amount={Math.abs(Number(r.wallet) || 0)}/>
        <Btn size="sm" variant={getCase('negative_wallet',r) ? 'ghost' : 'gold'} icon={<FileText size={13}/>} onClick={() => openCandidate('negative_wallet',r)} disabled={busy || !!caseError}>{getCase('negative_wallet',r) ? 'عرض الملف القانوني' : 'فتح ملف قانوني'}</Btn>
      </div>)}
      {!d.prepaidNegative.length && <Empty icon={<Scale/>} title="لا محافظ سالبة" sub="لا توجد حالات من هذا النوع"/>}
    </CandidateSection>

    {selectedCase && <CaseWorkspace value={selectedCase} canManage={canManage} userId={user.id} onClose={() => setSelectedCase(null)} onChanged={refresh}/>}
    <WhatsAppSendModal open={walletWaOpen} onClose={() => setWalletWaOpen(false)} recipients={walletRecipients} bucketLabel="مطالبة محافظ سالبة" onSent={() => setWalletWaOpen(false)}/>
  </div>;
}

function CandidateSection({ title, note, count, action, children }) {
  return <section className="legal-candidate-section">
    <header><div><span>{count}</span><div><h4>{title}</h4><p>{note}</p></div></div>{action}</header>
    <div>{children}</div>
  </section>;
}
