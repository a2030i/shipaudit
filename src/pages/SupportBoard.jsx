// «/support» — لوحة متابعة تذاكر خدمة العملاء (§1.35).
// سؤال واحد تجيبه: ما مشاكل العملاء المفتوحة الآن ومَن يتابعها؟
// تغيير الحالة من الصف مباشرة (بلا مودال) + درج تفاصيل بسجل الأحداث.
import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { LifeBuoy, Plus, RefreshCw, Download, Search, X, BarChart3, ListTodo, Lock, Paperclip, Clock3, CalendarClock, ListChecks } from 'lucide-react';
import { useRef } from 'react';
import * as XLSX from 'xlsx';
import { rtl } from '../lib/xlsxRtl.js';
import { persistAndDownloadExport } from '../lib/internalExportsService.js';
import { Card, Btn, Spinner, Empty, toast, PageHeader, Select, Modal } from '../components/UI.jsx';
import { MobileFilterBar } from '../components/MobileUX.jsx';
import TicketCreateForm from '../components/TicketCreateForm.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadLamhaCarrierOptions } from '../lib/platformCarriersService.js';
import { loadEmployees } from '../lib/employeeService.js';
import {
  TICKET_STATUSES, TICKET_CATEGORIES, ticketStatusMeta, ticketCategoryMeta,
  TICKET_PRIORITIES, CLOSURE_REASONS, ticketPriorityMeta,
  loadTickets, loadTicketStats, loadSupportDashboard,
  updateTicketStatus, assignTicket, updateTicketFollowup, bulkUpdateTickets, addTicketComment, loadTicketEvents, deleteTicket,
  loadTicketAttachments, uploadTicketAttachments, getAttachmentUrl,
} from '../lib/supportService.js';

const fmtDate = (d) => { try { return new Date(d).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' }); } catch { return String(d).slice(0, 10); } };
const fmtDateTime = (d) => { try { return new Date(d).toLocaleString('ar-SA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return String(d).slice(0, 16); } };
const fmtInputDateTime = (d) => {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};
const ageDays = (d) => Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);

function StatusPill({ status }) {
  const m = ticketStatusMeta(status);
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 20, whiteSpace: 'nowrap',
      fontSize: 11, fontWeight: 700, color: m.color,
      background: `color-mix(in srgb, ${m.color} 13%, transparent)`,
      border: `1px solid color-mix(in srgb, ${m.color} 30%, transparent)`,
    }}>{m.label}</span>
  );
}

function PriorityPill({ priority }) {
  const m = ticketPriorityMeta(priority);
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 20, whiteSpace: 'nowrap',
      fontSize: 10.5, fontWeight: 700, color: m.color,
      background: `color-mix(in srgb, ${m.color} 12%, transparent)`,
      border: `1px solid color-mix(in srgb, ${m.color} 28%, transparent)`,
    }}>{m.label}</span>
  );
}

// بطاقة إحصائية علوية — النقر يفلتر
function StatCard({ label, value, color, active, onClick }) {
  return (
    <button className="stat-card" onClick={onClick} style={{
      border: `1.5px solid ${active ? color : 'var(--border)'}`, borderRadius: 12,
      padding: '10px 14px', cursor: 'pointer', textAlign: 'start', fontFamily: 'var(--font-sans)',
      background: active ? `color-mix(in srgb, ${color} 8%, transparent)` : 'var(--card)',
      '--sc-tone': color || 'var(--accent)',
    }}>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-mono)', color }}>{value}</div>
    </button>
  );
}

const PAGE = 200;

export default function SupportBoard({ isActive = true }) {
  const { can, user, isAdmin } = useAuth();
  const location = useLocation();
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState(null);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [carriers, setCarriers] = useState([]);
  const [employees, setEmployees] = useState([]);
  // فلاتر
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [openOnly, setOpenOnly] = useState(true);   // الافتراضي: المفتوحة فقط
  const [carrierId, setCarrierId] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [category, setCategory] = useState('');
  const [attention, setAttention] = useState('');
  const [view, setView] = useState('list');         // list | dash
  const [dash, setDash] = useState(null);           // بيانات لوحة الأرقام
  const [drawer, setDrawer] = useState(null);       // التذكرة المفتوحة في الدرج
  const [events, setEvents] = useState(null);
  const [comment, setComment] = useState('');
  const [followupPriority, setFollowupPriority] = useState('normal');
  const [followupAt, setFollowupAt] = useState('');
  const [followupNote, setFollowupNote] = useState('');
  const [followupBusy, setFollowupBusy] = useState(false);
  const [closing, setClosing] = useState(null);
  const [closureReason, setClosureReason] = useState('');
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [closureBusy, setClosureBusy] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkPriority, setBulkPriority] = useState('');
  const [bulkAssignee, setBulkAssignee] = useState('__keep__');
  const [bulkFollowupMode, setBulkFollowupMode] = useState('keep');
  const [bulkFollowupAt, setBulkFollowupAt] = useState('');
  const [bulkClosureReason, setBulkClosureReason] = useState('');
  const [bulkResolution, setBulkResolution] = useState('');
  const [bulkNote, setBulkNote] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);          // مودال «تذكرة جديدة»
  const [attachments, setAttachments] = useState(null);         // مرفقات التذكرة المفتوحة
  const [attBusy, setAttBusy] = useState(false);
  const attRef = useRef(null);

  const refresh = async (soft = false) => {
    if (!soft) setBusy(true);
    try {
      const [s, t] = await Promise.all([
        loadTicketStats(),
        loadTickets({ status, carrierId, assignedTo, category, q, attention, openOnly: !status && !attention && openOnly, limit: PAGE }),
      ]);
      setStats(s); setRows(t.rows); setCount(t.count);
      loadSupportDashboard().then(setDash).catch(() => {});
    } catch (e) { toast(`فشل التحميل: ${e.message}`, 'error'); setRows(prev => prev || []); }
    setBusy(false);
  };
  useEffect(() => { if (isActive) refresh(); }, [isActive, status, carrierId, assignedTo, category, attention, openOnly, location.pathname]); // eslint-disable-line
  // بحث حر بتأخير بسيط
  useEffect(() => {
    if (!isActive) return;
    const h = setTimeout(() => refresh(true), 350);
    return () => clearTimeout(h);
  }, [q]); // eslint-disable-line
  useEffect(() => { setSelected(new Set()); }, [q, status, carrierId, assignedTo, category, attention, openOnly]);
  useEffect(() => {
    loadLamhaCarrierOptions().then(setCarriers).catch(() => {});
    loadEmployees().then(setEmployees).catch(() => {});
  }, []);

  const openDrawer = async (t) => {
    setDrawer(t); setEvents(null); setComment(''); setAttachments(null);
    setFollowupPriority(t.priority || 'normal');
    setFollowupAt(fmtInputDateTime(t.nextFollowupAt));
    setFollowupNote('');
    loadTicketAttachments(t.id).then(setAttachments).catch(() => setAttachments([]));
    try { setEvents(await loadTicketEvents(t.id)); } catch { setEvents([]); }
  };

  // فتح مرفق برابط موقّت (الـbucket خاص)
  const openAttachment = async (a) => {
    try { window.open(await getAttachmentUrl(a.filePath), '_blank', 'noopener'); }
    catch (e) { toast(`تعذّر فتح المرفق: ${e.message}`, 'error'); }
  };
  const addAttachments = async (list) => {
    const files = Array.from(list || []).filter(f => f.size <= 10 * 1024 * 1024);
    if (Array.from(list || []).length !== files.length) toast('تجاهلت ملفات أكبر من 10MB', 'error');
    if (!files.length || !drawer) return;
    setAttBusy(true);
    try {
      await uploadTicketAttachments(drawer.id, files, user?.id);
      toast(`أُرفق ${files.length} ملف ✓`, 'success');
      loadTicketAttachments(drawer.id).then(setAttachments).catch(() => {});
      loadTicketEvents(drawer.id).then(setEvents).catch(() => {});
    } catch (e) { toast(e.message, 'error'); }
    setAttBusy(false);
    if (attRef.current) attRef.current.value = '';
  };

  const changeStatus = async (t, newStatus) => {
    if (!can('support.manage')) return toast('تحتاج صلاحية «تغيير حالة التذاكر»', 'error');
    if (newStatus === 'resolved' || newStatus === 'closed') {
      setClosing({ ticket: t, status: newStatus });
      setClosureReason('');
      setResolutionSummary('');
      return;
    }
    try {
      await updateTicketStatus(t.id, { newStatus });
      toast(`${t.ref} → ${ticketStatusMeta(newStatus).label}`, 'success');
      if (drawer?.id === t.id) {
        setDrawer({ ...drawer, status: newStatus, closureReason: null, resolutionSummary: null });
        loadTicketEvents(t.id).then(setEvents).catch(() => {});
      }
      refresh(true);
    } catch (e) { toast(`فشل التحديث: ${e.message}`, 'error'); }
  };

  const confirmClosure = async () => {
    if (!closing || !closureReason || !resolutionSummary.trim()) return;
    setClosureBusy(true);
    try {
      const t = closing.ticket;
      await updateTicketStatus(t.id, {
        newStatus: closing.status,
        closureReason,
        resolutionSummary: resolutionSummary.trim(),
      });
      toast(`${t.ref} → ${ticketStatusMeta(closing.status).label}`, 'success');
      if (drawer?.id === t.id) {
        setDrawer({
          ...drawer, status: closing.status, closureReason,
          resolutionSummary: resolutionSummary.trim(), nextFollowupAt: null,
        });
        loadTicketEvents(t.id).then(setEvents).catch(() => {});
      }
      setClosing(null);
      refresh(true);
    } catch (e) { toast(`فشل الإغلاق: ${e.message}`, 'error'); }
    setClosureBusy(false);
  };

  const changeAssignee = async (t, assigneeId) => {
    if (!can('support.manage')) return toast('تحتاج صلاحية «إدارة التذاكر»', 'error');
    const emp = employees.find(e => e.id === assigneeId);
    try {
      await assignTicket(t.id, { assigneeId: assigneeId || null });
      toast(emp ? `${t.ref} أُسندت إلى ${emp.name}` : `${t.ref} — أُلغي الإسناد`, 'success');
      if (drawer?.id === t.id) setDrawer({ ...drawer, assignedTo: assigneeId || null, assigneeName: emp?.name || null });
      refresh(true);
    } catch (e) { toast(`فشل الإسناد: ${e.message}`, 'error'); }
  };

  const sendComment = async () => {
    const note = comment.trim();
    if (!note || !drawer) return;
    try {
      await addTicketComment(drawer.id, { note, userId: user?.id, internal: true });
      setComment('');
      setEvents(await loadTicketEvents(drawer.id));
    } catch (e) { toast(`فشل حفظ التعليق: ${e.message}`, 'error'); }
  };

  const saveFollowup = async () => {
    if (!drawer || !can('support.manage')) return;
    setFollowupBusy(true);
    try {
      await updateTicketFollowup(drawer.id, {
        priority: followupPriority,
        nextFollowupAt: followupAt ? new Date(followupAt).toISOString() : null,
        note: followupNote.trim() || null,
      });
      const next = followupAt ? new Date(followupAt).toISOString() : null;
      setDrawer({ ...drawer, priority: followupPriority, nextFollowupAt: next });
      setFollowupNote('');
      setEvents(await loadTicketEvents(drawer.id));
      toast('حُفظت المتابعة الإدارية', 'success');
      refresh(true);
    } catch (e) { toast(`فشل حفظ المتابعة: ${e.message}`, 'error'); }
    setFollowupBusy(false);
  };

  const toggleSelected = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    const ids = (rows || []).map(r => r.id);
    const allOn = ids.length > 0 && ids.every(id => selected.has(id));
    setSelected(allOn ? new Set() : new Set(ids));
  };

  const openBulk = () => {
    if (!selected.size) return;
    setBulkStatus(''); setBulkPriority(''); setBulkAssignee('__keep__');
    setBulkFollowupMode('keep'); setBulkFollowupAt('');
    setBulkClosureReason(''); setBulkResolution(''); setBulkNote('');
    setBulkOpen(true);
  };

  const applyBulk = async () => {
    const closingBulk = bulkStatus === 'resolved' || bulkStatus === 'closed';
    const hasChange = bulkStatus || bulkPriority || bulkAssignee !== '__keep__'
      || bulkFollowupMode !== 'keep' || bulkNote.trim();
    if (!hasChange) return toast('اختر إجراءً واحداً على الأقل', 'error');
    if (bulkFollowupMode === 'set' && !bulkFollowupAt) return toast('حدد موعد المتابعة', 'error');
    if (closingBulk && (!bulkClosureReason || !bulkResolution.trim())) return toast('سبب الإغلاق وخلاصة الحل إلزاميان', 'error');
    setBulkBusy(true);
    try {
      const r = await bulkUpdateTickets([...selected], {
        status: bulkStatus || null,
        priority: bulkPriority || null,
        assigneeMode: bulkAssignee === '__keep__' ? 'keep' : bulkAssignee === '__clear__' ? 'clear' : 'set',
        assigneeId: !bulkAssignee.startsWith('__') ? bulkAssignee : null,
        followupMode: bulkFollowupMode,
        nextFollowupAt: bulkFollowupMode === 'set' ? new Date(bulkFollowupAt).toISOString() : null,
        closureReason: closingBulk ? bulkClosureReason : null,
        resolutionSummary: closingBulk ? bulkResolution.trim() : null,
        note: bulkNote.trim() || null,
      });
      toast(`حُدّثت ${r.updated} تذكرة بنجاح`, 'success');
      setSelected(new Set()); setBulkOpen(false);
      refresh(true);
    } catch (e) { toast(`فشل التحديث الجماعي: ${e.message}`, 'error'); }
    setBulkBusy(false);
  };

  const removeTicket = async (t) => {
    if (!window.confirm(`حذف ${t.ref} نهائياً؟`)) return;
    try {
      await deleteTicket(t.id);
      toast(`حُذفت ${t.ref}`, 'success');
      setDrawer(null); refresh(true);
    } catch (e) { toast(`فشل الحذف: ${e.message}`, 'error'); }
  };

  const exportXlsx = async () => {
    if (!rows?.length) return;
    const headers = ['الرقم', 'المتجر', 'الهاتف', 'النوع', 'شركة الشحن', 'AWB', 'الحالة', 'الأولوية', 'المسؤول', 'المتابعة القادمة', 'أنشأها', 'التاريخ', 'العمر (يوم)', 'سبب الإغلاق', 'خلاصة الحل', 'الوصف'];
    const aoa = [
      ['تذاكر خدمة العملاء', '', new Date().toISOString().slice(0, 10)],
      [],
      headers,
      ...rows.map(t => [t.ref, t.storeName, t.customerPhone || '', ticketCategoryMeta(t.category).label, t.carrierName || '', t.awb || '',
        ticketStatusMeta(t.status).label, ticketPriorityMeta(t.priority).label, t.assigneeName || '',
        t.nextFollowupAt ? new Date(t.nextFollowupAt).toLocaleString('en-CA') : '', t.creatorName || '',
        new Date(t.createdAt).toLocaleDateString('en-CA'), ageDays(t.createdAt),
        CLOSURE_REASONS[t.closureReason] || '', t.resolutionSummary || '', t.description || '']),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 10 }, { wch: 26 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 13 }, { wch: 11 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 11 }, { wch: 10 }, { wch: 20 }, { wch: 34 }, { wch: 44 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'التذاكر');
    rtl(wb);
    try {
      await persistAndDownloadExport({
        wb, fileName: `تذاكر_الدعم_${new Date().toISOString().slice(0, 10)}.xlsx`,
        kind: 'support_tickets', rowCount: rows.length, userId: user?.id || null,
      });
      toast('صُدّر ملف التذاكر ✓', 'success');
    } catch (e) { toast(`فشل التصدير: ${e.message}`, 'error'); }
  };

  if (!can('support.view')) return <div style={{ padding: 40 }}><Empty icon="🔒" title="لا صلاحية" sub="تحتاج صلاحية «عرض لوحة التذاكر»"/></div>;
  if (rows == null) return <div style={{ padding: 60, textAlign: 'center' }}><Spinner size={26}/></div>;

  const pickStat = (key) => {
    setAttention('');
    if (key === 'all') { setStatus(''); setOpenOnly(false); }
    else if (key === 'openOnly') { setStatus(''); setOpenOnly(true); }
    else { setStatus(key); setOpenOnly(false); }
  };
  const pickAttention = (key) => {
    setStatus('');
    setOpenOnly(false);
    setAttention(attention === key ? '' : key);
  };
  const supportFilterFields = (
    <>
      <Select aria-label="نوع التذكرة" value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="">كل الأنواع</option>
        {Object.entries(TICKET_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
      </Select>
      <Select aria-label="شركة الشحن" value={carrierId} onChange={(e) => setCarrierId(e.target.value)}>
        <option value="">كل الشركات</option>
        {carriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
      <Select aria-label="المسؤول" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
        <option value="">كل المسؤولين</option>
        {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
      </Select>
    </>
  );
  const supportActiveFilters = [
    category && { id: 'category', label: `النوع: ${TICKET_CATEGORIES[category]?.label || category}`, onRemove: () => setCategory('') },
    carrierId && { id: 'carrier', label: `الشركة: ${carriers.find(c => c.id === carrierId)?.name || carrierId}`, onRemove: () => setCarrierId('') },
    assignedTo && { id: 'owner', label: `المسؤول: ${employees.find(e => e.id === assignedTo)?.name || assignedTo}`, onRemove: () => setAssignedTo('') },
    status && { id: 'status', label: `الحالة: ${ticketStatusMeta(status).label}`, onRemove: () => setStatus('') },
    attention && { id: 'attention', label: 'يحتاج انتباهًا', onRemove: () => setAttention('') },
    openOnly && { id: 'open', label: 'المفتوحة فقط', onRemove: () => setOpenOnly(false) },
  ].filter(Boolean);
  const clearSupportFilters = () => {
    setCategory(''); setCarrierId(''); setAssignedTo(''); setStatus(''); setAttention(''); setOpenOnly(false);
  };

  return (
    <div className="support-board-page" style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader icon={<LifeBuoy size={22}/>} iconColor="var(--accent3)"
        title="تذاكر خدمة العملاء"
        subtitle="سجّل المشكلة قبل أن تضيع — تابعها حتى تُحل"
        actions={
          <>
            <Btn size="sm" variant="primary" icon={<Plus size={14}/>}
              onClick={() => setCreateOpen(true)}>تذكرة جديدة</Btn>
            <Btn size="sm" variant="ghost" icon={<Download size={13}/>} onClick={exportXlsx} disabled={!rows.length}>تصدير</Btn>
            <Btn size="sm" variant="ghost" icon={<RefreshCw size={14} className={busy ? 'spin' : ''}/>} onClick={() => refresh()} disabled={busy}>تحديث</Btn>
          </>
        }/>

      {/* ── مبدّل العرض: قائمة التذاكر | لوحة الأرقام ── */}
      <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 11, background: 'var(--surface)', border: '1px solid var(--border)', marginBottom: 14 }}>
        {[{ id: 'list', label: 'التذاكر', icon: ListTodo }, { id: 'dash', label: 'لوحة الأرقام', icon: BarChart3 }].map(v => {
          const Icon = v.icon; const on = view === v.id;
          return (
            <button key={v.id} onClick={() => setView(v.id)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 16px',
              borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)',
              fontSize: 12.5, fontWeight: on ? 700 : 500,
              background: on ? 'var(--card)' : 'transparent',
              color: on ? 'var(--text)' : 'var(--muted)',
              boxShadow: on ? '0 1px 4px rgba(0,0,0,.08)' : 'none',
            }}>
              <Icon size={14}/>{v.label}
            </button>
          );
        })}
      </div>

      {view === 'list' && (<>
      {/* ── ما يحتاج متابعة إدارية الآن ── */}
      {stats && (
        <>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', marginBottom: 7 }}>ما يحتاج انتباهك الآن</div>
          <div className="hero-grid support-decision-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 10 }}>
            <StatCard label="متابعة متأخرة" value={stats.overdue} color="var(--red)" active={attention === 'overdue'} onClick={() => pickAttention('overdue')}/>
            <StatCard label="مستحقة خلال 24 ساعة" value={stats.due24h} color="var(--gold)" active={attention === 'due24h'} onClick={() => pickAttention('due24h')}/>
            <StatCard label="بلا مسؤول" value={stats.unassigned} color="var(--accent3)" active={attention === 'unassigned'} onClick={() => pickAttention('unassigned')}/>
            <StatCard label="بلا موعد متابعة" value={stats.noFollowup} color="var(--muted)" active={attention === 'without_followup'} onClick={() => pickAttention('without_followup')}/>
          </div>
          <div className="hero-grid support-status-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 8, marginBottom: 16 }}>
            <StatCard label="جديدة" value={stats.open} color="var(--accent3)" active={status === 'open'} onClick={() => pickStat('open')}/>
            <StatCard label="قيد المعالجة" value={stats.inProgress} color="var(--gold)" active={status === 'in_progress'} onClick={() => pickStat('in_progress')}/>
            <StatCard label="بانتظار العميل" value={stats.waiting} color="var(--accent)" active={status === 'waiting_customer'} onClick={() => pickStat('waiting_customer')}/>
            <StatCard label="حُلّت آخر 7 أيام" value={stats.resolved7d} color="var(--green)" active={status === 'resolved'} onClick={() => pickStat('resolved')}/>
            <StatCard label="الكل" value={stats.total} color="var(--muted)" active={!status && !attention && !openOnly} onClick={() => pickStat('all')}/>
          </div>
        </>
      )}

      {/* ── شريط الفلاتر ── */}
      <MobileFilterBar
        title="فلترة التذاكر"
        search={(
        <div style={{ position: 'relative', width: '100%' }}>
          <Search size={13} style={{ position: 'absolute', insetInlineStart: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted2)' }}/>
          <input value={q} onChange={(e) => setQ(e.target.value)}
            aria-label="البحث في التذاكر"
            placeholder="بحث: متجر / عنوان / AWB / هاتف / TKT-…"
            style={{
              width: '100%', padding: '8px 30px 8px 10px', borderRadius: 9,
              border: '1.5px solid var(--border)', background: 'var(--surface)', color: 'var(--text)',
              fontSize: 12.5, fontFamily: 'var(--font-sans)', outline: 'none',
            }}/>
        </div>)}
        desktop={<div className="workspace-filter-bar" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>{supportFilterFields}<span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{count} تذكرة</span></div>}
        activeFilters={supportActiveFilters}
        onClear={clearSupportFilters}
      >{supportFilterFields}</MobileFilterBar>

      {selected.size > 0 && can('support.manage') && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          padding: '9px 11px', marginBottom: 10, borderRadius: 10,
          border: '1px solid color-mix(in srgb, var(--accent) 28%, var(--border))',
          background: 'color-mix(in srgb, var(--accent) 6%, var(--card))',
        }}>
          <ListChecks size={16} color="var(--accent)"/>
          <b style={{ fontSize: 12.5 }}>{selected.size} محددة</b>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>غيّر الحالة أو المسؤول أو الأولوية أو موعد المتابعة دفعة واحدة</span>
          <Btn size="sm" variant="accent" onClick={openBulk} style={{ marginInlineStart: 'auto' }}>تحديث جماعي</Btn>
          <Btn size="sm" variant="ghost" onClick={() => setSelected(new Set())}>إلغاء التحديد</Btn>
        </div>
      )}

      {/* ── الجدول ── */}
      {!rows.length ? (
        <Card><Empty icon="🎉" title="لا تذاكر هنا" sub={openOnly && !status ? 'لا مشاكل مفتوحة الآن' : 'جرّب تعديل الفلاتر'}/></Card>
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div className="m-flow" style={{ overflowX: 'auto' }}>
            <table className="m-cards" style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
              <thead style={{ background: 'var(--surface)' }}>
                <tr>
                  {can('support.manage') && (
                    <th style={{ padding: '9px 10px', width: 34 }}>
                      <input type="checkbox" aria-label="تحديد كل التذاكر الظاهرة"
                        checked={rows.length > 0 && rows.every(r => selected.has(r.id))}
                        onChange={toggleAllVisible}/>
                    </th>
                  )}
                  {['الرقم', 'المتجر', 'المشكلة', 'الأولوية', 'الحالة', 'المسؤول', 'المتابعة', 'العمر', ''].map(h => (
                    <th key={h} style={{ padding: '9px 12px', fontSize: 11, color: 'var(--muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(t => {
                  const age = ageDays(t.createdAt);
                  const stale = age >= 3 && !['resolved', 'closed'].includes(t.status);
                  const overdue = t.nextFollowupAt && new Date(t.nextFollowupAt).getTime() < Date.now() && !['resolved', 'closed'].includes(t.status);
                  return (
                    <tr key={t.id} style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => openDrawer(t)}>
                      {can('support.manage') && (
                        <td data-label="تحديد" style={{ padding: '8px 10px' }} onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" aria-label={`تحديد ${t.ref}`} checked={selected.has(t.id)} onChange={() => toggleSelected(t.id)}/>
                        </td>
                      )}
                      <td data-label="" style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)', whiteSpace: 'nowrap' }}>{t.ref}</td>
                      <td data-label="المتجر" style={{ padding: '8px 12px', fontWeight: 600 }}>{t.storeName}</td>
                      <td data-label="المشكلة" style={{ padding: '8px 12px', maxWidth: 320 }}>
                        <div style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description || t.title}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--muted2)', marginTop: 2 }}>
                          {ticketCategoryMeta(t.category).icon} {ticketCategoryMeta(t.category).label}
                          {t.carrierName ? ` · ${t.carrierName}` : ''}
                        </div>
                      </td>
                      <td data-label="الأولوية" style={{ padding: '8px 12px' }}><PriorityPill priority={t.priority}/></td>
                      <td data-label="الحالة" style={{ padding: '8px 12px' }} onClick={(e) => e.stopPropagation()}>
                        {can('support.manage') ? (
                          <select value={t.status} onChange={(e) => changeStatus(t, e.target.value)}
                            style={{
                              padding: '4px 8px', borderRadius: 8, fontSize: 11.5, fontWeight: 700,
                              fontFamily: 'var(--font-sans)', cursor: 'pointer', outline: 'none',
                              color: ticketStatusMeta(t.status).color,
                              background: `color-mix(in srgb, ${ticketStatusMeta(t.status).color} 10%, transparent)`,
                              border: `1px solid color-mix(in srgb, ${ticketStatusMeta(t.status).color} 30%, transparent)`,
                            }}>
                            {Object.entries(TICKET_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                          </select>
                        ) : <StatusPill status={t.status}/>}
                      </td>
                      <td data-label="المسؤول" style={{ padding: '8px 12px', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                        {can('support.manage') ? (
                          <select value={t.assignedTo || ''} onChange={(e) => changeAssignee(t, e.target.value)}
                            style={{
                              padding: '4px 8px', borderRadius: 8, fontSize: 11.5, fontFamily: 'var(--font-sans)',
                              border: '1px solid var(--border)', background: 'var(--surface)',
                              color: t.assignedTo ? 'var(--text)' : 'var(--muted2)', cursor: 'pointer', outline: 'none',
                            }}>
                            <option value="">بلا مسؤول</option>
                            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                          </select>
                        ) : (t.assigneeName || '—')}
                      </td>
                      <td data-label="المتابعة" style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: overdue ? 'var(--red)' : 'var(--muted)', fontWeight: overdue ? 700 : 400 }}>
                        {t.nextFollowupAt ? <>{overdue ? '⚠ ' : ''}{fmtDateTime(t.nextFollowupAt)}</> : 'غير محددة'}
                      </td>
                      <td data-label="العمر" style={{ padding: '8px 12px', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', color: stale ? 'var(--red)' : 'var(--muted)', fontWeight: stale ? 700 : 400 }}>
                        {age === 0 ? 'اليوم' : `${age} يوم`}{stale ? ' ⚠' : ''}
                      </td>
                      <td data-label="التاريخ" style={{ padding: '8px 12px', fontSize: 11, color: 'var(--muted2)', whiteSpace: 'nowrap' }}>{fmtDate(t.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      </>)}

      {/* ── لوحة الأرقام: الحالات × النوع × شركات الشحن ── */}
      {view === 'dash' && (!dash ? <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={22}/></div> : (
        <>
          <div className="hero-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'إجمالي التذاكر', value: stats?.total ?? 0, color: 'var(--accent)' },
              { label: 'مفتوحة الآن', value: (stats?.open ?? 0) + (stats?.inProgress ?? 0) + (stats?.waiting ?? 0), color: 'var(--accent3)' },
              { label: 'متابعة متأخرة', value: stats?.overdue ?? 0, color: 'var(--red)' },
              { label: 'متوسط زمن الحل', value: dash.avgResolutionHours == null ? '—' : (dash.avgResolutionHours >= 48 ? `${(dash.avgResolutionHours / 24).toFixed(1)} يوم` : `${dash.avgResolutionHours} ساعة`), color: 'var(--gold)' },
              { label: 'أُنشئت آخر 30 يوم', value: dash.created30d, color: 'var(--accent)' },
              { label: 'حُلّت آخر 30 يوم', value: dash.resolved30d, color: 'var(--green)' },
            ].map(c => (
              <div key={c.label} style={{ border: '1.5px solid var(--border)', borderRadius: 12, padding: '10px 14px', background: 'var(--card)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-mono)', color: c.color }}>{c.value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(290px,1fr))', gap: 12 }}>
            {/* المتابعة حسب المسؤول — القياس الإداري الأساسي */}
            <Card style={{ padding: '14px 16px', gridColumn: '1 / -1' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>متابعة الفريق</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>العمل المفتوح والمواعيد المتأخرة داخل نظامنا فقط؛ لا يفترض حالة الرد في هاتف.</div>
              {!dash.byOwner.length ? <Empty icon="👥" title="لا بيانات بعد"/> : (
                <div className="m-flow" style={{ overflowX: 'auto' }}>
                  <table className="m-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead><tr>{['المسؤول', 'مفتوحة', 'متأخرة', 'خلال 24 ساعة', 'حُلّت 30 يوم', 'متوسط الحل'].map(h => (
                      <th key={h} style={{ padding: '7px 9px', textAlign: 'right', color: 'var(--muted)', borderBottom: '1px solid var(--border)', fontSize: 10.5 }}>{h}</th>
                    ))}</tr></thead>
                    <tbody>{dash.byOwner.map(r => (
                      <tr key={r.ownerId || 'none'} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td data-label="المسؤول" style={{ padding: '8px 9px', fontWeight: 700 }}>{r.ownerName}</td>
                        <td data-label="مفتوحة" style={{ padding: '8px 9px', fontFamily: 'var(--font-mono)' }}>{r.open}</td>
                        <td data-label="متأخرة" style={{ padding: '8px 9px', fontFamily: 'var(--font-mono)', color: r.overdue ? 'var(--red)' : 'var(--muted)', fontWeight: r.overdue ? 800 : 400 }}>{r.overdue}</td>
                        <td data-label="خلال 24 ساعة" style={{ padding: '8px 9px', fontFamily: 'var(--font-mono)', color: r.due24h ? 'var(--gold)' : 'var(--muted)' }}>{r.due24h}</td>
                        <td data-label="حُلّت 30 يوم" style={{ padding: '8px 9px', fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>{r.resolved30d}</td>
                        <td data-label="متوسط الحل" style={{ padding: '8px 9px' }}>{r.avgResolutionHours == null ? '—' : `${r.avgResolutionHours} ساعة`}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* حسب الحالة */}
            <Card style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', marginBottom: 10 }}>حسب الحالة</div>
              {Object.entries(TICKET_STATUSES).map(([k, v]) => {
                const n = Number(dash.byStatus[k]) || 0;
                const max = Math.max(1, ...Object.values(dash.byStatus).map(Number));
                return (
                  <div key={k} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                      <span style={{ color: 'var(--text)' }}>{v.label}</span>
                      <b style={{ fontFamily: 'var(--font-mono)', color: v.color }}>{n}</b>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: 'var(--surface2)', overflow: 'hidden' }}>
                      <div style={{ width: `${(n / max) * 100}%`, height: '100%', background: v.color, transition: 'width .3s' }}/>
                    </div>
                  </div>
                );
              })}
            </Card>

            {/* حسب النوع */}
            <Card style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', marginBottom: 10 }}>حسب نوع المشكلة</div>
              {!dash.byCategory.length ? <Empty icon="📊" title="لا بيانات بعد"/> : dash.byCategory.map(r => {
                const m = ticketCategoryMeta(r.category);
                const max = Math.max(1, ...dash.byCategory.map(x => x.total));
                return (
                  <div key={r.category} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                      <span style={{ color: 'var(--text)' }}>{m.icon} {m.label}</span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>
                        <b>{r.total}</b>{r.open > 0 && <span style={{ color: 'var(--red)', fontSize: 10.5 }}> · {r.open} مفتوحة</span>}
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: 'var(--surface2)', overflow: 'hidden' }}>
                      <div style={{ width: `${(r.total / max) * 100}%`, height: '100%', background: 'var(--accent)', transition: 'width .3s' }}/>
                    </div>
                  </div>
                );
              })}
            </Card>

            {/* حسب شركة الشحن */}
            <Card style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', marginBottom: 10 }}>حسب شركة الشحن</div>
              {!dash.byCarrier.length ? <Empty icon="📊" title="لا بيانات بعد"/> : dash.byCarrier.map(r => {
                const max = Math.max(1, ...dash.byCarrier.map(x => x.total));
                return (
                  <div key={r.carrierId || 'none'} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                      <span style={{ color: 'var(--text)' }}>{r.carrierName}</span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>
                        <b>{r.total}</b>{r.open > 0 && <span style={{ color: 'var(--red)', fontSize: 10.5 }}> · {r.open} مفتوحة</span>}
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: 'var(--surface2)', overflow: 'hidden' }}>
                      <div style={{ width: `${(r.total / max) * 100}%`, height: '100%', background: '#3B82F6', transition: 'width .3s' }}/>
                    </div>
                  </div>
                );
              })}
            </Card>
          </div>
        </>
      ))}

      {/* ── مودال تذكرة جديدة — نفس نموذج /ticket (مكوّن مشترك) ── */}
      {createOpen && (
        <Modal title="تذكرة دعم جديدة" width={580} onClose={() => setCreateOpen(false)}>
          <TicketCreateForm
            onCreated={() => refresh(true)}
            onClose={() => setCreateOpen(false)}/>
        </Modal>
      )}

      {/* ── درج التفاصيل ── */}
      {drawer && (
        <div onClick={() => setDrawer(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,.38)', display: 'flex', justifyContent: 'flex-start' }}>
          {/* role=dialog على اللوح لا الطبقة، وبلا m-flow (اللوح fixed يحتاج
              تمريره الداخلي — m-flow كان يلغيه فيُحبس السجل على الجوال) */}
          <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={{
            width: 'min(94vw, 460px)', height: '100%', overflowY: 'auto',
            background: 'var(--card)', borderInlineEnd: '1px solid var(--border)',
            padding: '18px 18px 40px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 16, color: 'var(--accent)' }}>{drawer.ref}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>{drawer.title}</div>
              </div>
              <button onClick={() => setDrawer(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--muted)' }}><X size={18}/></button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12, marginBottom: 12 }}>
              <div><span style={{ color: 'var(--muted2)' }}>المتجر: </span><b>{drawer.storeName}</b></div>
              <div><span style={{ color: 'var(--muted2)' }}>الهاتف: </span><span style={{ fontFamily: 'var(--font-mono)', direction: 'ltr' }}>{drawer.customerPhone || '—'}</span></div>
              <div><span style={{ color: 'var(--muted2)' }}>النوع: </span>{ticketCategoryMeta(drawer.category).icon} {ticketCategoryMeta(drawer.category).label}</div>
              <div><span style={{ color: 'var(--muted2)' }}>الشركة: </span>{drawer.carrierName || '—'}</div>
              <div><span style={{ color: 'var(--muted2)' }}>AWB: </span><span style={{ fontFamily: 'var(--font-mono)', direction: 'ltr' }}>{drawer.awb || '—'}</span></div>
              <div><span style={{ color: 'var(--muted2)' }}>أنشأها: </span>{drawer.creatorName || '—'}</div>
              <div><span style={{ color: 'var(--muted2)' }}>التاريخ: </span>{fmtDateTime(drawer.createdAt)}</div>
              <div style={{ gridColumn: '1 / -1' }}>
                <span style={{ color: 'var(--muted2)' }}>الحالة: </span><StatusPill status={drawer.status}/>
                <span style={{ marginInlineStart: 8 }}><PriorityPill priority={drawer.priority}/></span>
              </div>
            </div>

            {drawer.description && (
              <div style={{ fontSize: 12.5, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: 14, whiteSpace: 'pre-wrap' }}>
                {drawer.description}
              </div>
            )}

            {/* ── متابعة إدارية داخل نظامنا ── */}
            <div style={{
              padding: 12, borderRadius: 12, marginBottom: 14,
              border: '1px solid color-mix(in srgb, var(--accent3) 30%, var(--border))',
              background: 'color-mix(in srgb, var(--accent3) 6%, var(--card))',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3, fontSize: 12.5, fontWeight: 800 }}>
                <CalendarClock size={15} color="var(--accent3)"/> المتابعة الإدارية
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 10 }}>هذه بيانات داخلية للتنظيم؛ المحادثة والرد على العميل يستمران في هاتف.</div>
              {can('support.manage') ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px,.7fr) minmax(180px,1.3fr)', gap: 8 }}>
                    <label style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                      الأولوية
                      <Select value={followupPriority} onChange={(e) => setFollowupPriority(e.target.value)} style={{ width: '100%', marginTop: 4 }}>
                        {Object.entries(TICKET_PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </Select>
                    </label>
                    <label style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                      موعد المتابعة القادمة
                      <input type="datetime-local" value={followupAt} onChange={(e) => setFollowupAt(e.target.value)}
                        style={{ width: '100%', marginTop: 4, padding: '8px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'var(--font-sans)', fontSize: 11.5 }}/>
                    </label>
                  </div>
                  <textarea value={followupNote} onChange={(e) => setFollowupNote(e.target.value)}
                    placeholder="ما الذي تم؟ وما الخطوة القادمة؟ (اختياري)"
                    style={{ width: '100%', minHeight: 58, resize: 'vertical', marginTop: 8, padding: '8px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'var(--font-sans)', fontSize: 11.5 }}/>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 7 }}>
                    <span style={{ fontSize: 10.5, color: drawer.nextFollowupAt && new Date(drawer.nextFollowupAt) < new Date() ? 'var(--red)' : 'var(--muted)' }}>
                      {drawer.nextFollowupAt ? `المسجل: ${fmtDateTime(drawer.nextFollowupAt)}` : 'لم يُحدد موعد بعد'}
                    </span>
                    <Btn size="sm" variant="accent" onClick={saveFollowup} disabled={followupBusy}
                      icon={followupBusy ? <Spinner size={12}/> : <Clock3 size={12}/>}>حفظ المتابعة</Btn>
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12 }}>
                  <b>{ticketPriorityMeta(drawer.priority).label}</b>
                  <span style={{ color: 'var(--muted)' }}> · {drawer.nextFollowupAt ? fmtDateTime(drawer.nextFollowupAt) : 'بلا موعد متابعة'}</span>
                </div>
              )}
            </div>

            {/* ── المرفقات ── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>
                📎 المرفقات {attachments?.length ? `(${attachments.length})` : ''}
              </span>
              <input ref={attRef} type="file" multiple hidden
                accept="image/*,.pdf,.xlsx,.xls,.csv" onChange={(e) => addAttachments(e.target.files)}/>
              <Btn size="sm" variant="ghost" icon={attBusy ? <Spinner size={12}/> : <Paperclip size={12}/>}
                onClick={() => attRef.current?.click()} disabled={attBusy}>إرفاق</Btn>
            </div>
            {attachments == null ? <Spinner size={14}/> : !attachments.length ? (
              <div style={{ fontSize: 11.5, color: 'var(--muted2)', marginBottom: 14 }}>لا مرفقات</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14 }}>
                {attachments.map(a => (
                  <button key={a.id} onClick={() => openAttachment(a)} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                    padding: '7px 10px', borderRadius: 9, border: '1px solid var(--border)',
                    background: 'var(--surface)', cursor: 'pointer', textAlign: 'start',
                    fontFamily: 'var(--font-sans)', width: '100%',
                  }}>
                    <span style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      📎 {a.fileName}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--muted2)', whiteSpace: 'nowrap' }}>
                      {a.sizeBytes ? `${(a.sizeBytes / 1024 / 1024).toFixed(1)}MB · ` : ''}{a.uploaderName} ⬇️
                    </span>
                  </button>
                ))}
              </div>
            )}

            {can('support.manage') && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
                {Object.entries(TICKET_STATUSES).filter(([k]) => k !== drawer.status).map(([k, v]) => (
                  <Btn key={k} size="sm" variant={k === 'resolved' ? 'accent' : 'ghost'}
                    onClick={() => changeStatus(drawer, k)}>{v.label}</Btn>
                ))}
              </div>
            )}

            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>سجل التذكرة</div>
            {events == null ? <Spinner size={18}/> : !events.length ? (
              <div style={{ fontSize: 12, color: 'var(--muted2)' }}>لا أحداث بعد</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                {events.map(e => (
                  <div key={e.id} style={{ fontSize: 12, borderInlineStart: '2.5px solid var(--border)', paddingInlineStart: 10 }}>
                    <div style={{ color: 'var(--text)' }}>
                      {e.kind === 'create' && '🆕 أُنشئت التذكرة'}
                      {e.kind === 'status' && <>🔄 {ticketStatusMeta(e.oldStatus).label} ← <b style={{ color: ticketStatusMeta(e.newStatus).color }}>{ticketStatusMeta(e.newStatus).label}</b></>}
                      {e.kind === 'assign' && `👤 ${e.note || 'تغيير الإسناد'}`}
                      {e.kind === 'attach' && `${e.note || '📎 مرفق جديد'}`}
                      {e.kind === 'followup' && `⏱ ${e.note || 'تحديث المتابعة الإدارية'}`}
                      {e.kind === 'comment' && (
                        <>
                          {e.internal ? '🔒' : '💬'} {e.note}
                          {e.internal && (
                            <span style={{
                              marginInlineStart: 6, fontSize: 9.5, fontWeight: 700, padding: '1px 7px',
                              borderRadius: 10, color: 'var(--muted)', background: 'var(--surface2)',
                              border: '1px solid var(--border)', verticalAlign: 'middle',
                            }}>داخلية</span>
                          )}
                        </>
                      )}
                    </div>
                    {(e.kind === 'status' || e.kind === 'followup') && e.note && e.kind !== 'followup' && <div style={{ color: 'var(--muted)', marginTop: 2 }}>{e.note}</div>}
                    <div style={{ fontSize: 10.5, color: 'var(--muted2)', marginTop: 2 }}>{e.userName} · {fmtDateTime(e.createdAt)}</div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 6 }}>
              <input value={comment} onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') sendComment(); }}
                placeholder="ملاحظة داخلية للفريق…"
                style={{
                  flex: 1, padding: '8px 10px', borderRadius: 9,
                  border: '1.5px solid var(--border)',
                  background: 'var(--surface)', color: 'var(--text)',
                  fontSize: 12.5, fontFamily: 'var(--font-sans)', outline: 'none',
                }}/>
              <Btn size="sm" variant="accent" onClick={sendComment} disabled={!comment.trim()}>حفظ</Btn>
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 7, fontSize: 11.5, color: 'var(--muted)' }}>
              <Lock size={11}/> داخلية فقط — لا تُرسل إلى هاتف أو إلى العميل
            </div>

            {(isAdmin || can('support.delete')) && (
              <div style={{ marginTop: 18, textAlign: 'end' }}>
                <Btn size="sm" variant="danger" onClick={() => removeTicket(drawer)}>حذف التذكرة</Btn>
              </div>
            )}
          </div>
        </div>
      )}

      {closing && (
        <Modal title={`${ticketStatusMeta(closing.status).label} ${closing.ticket.ref}`} width={500} onClose={() => !closureBusy && setClosing(null)}>
          <div className="m-flow" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: '9px 11px', borderRadius: 9, background: 'var(--surface)', color: 'var(--muted)', fontSize: 11.5 }}>
              الإغلاق توثيق إداري فقط. لا يغيّر حالة المحادثة في هاتف ولا يرسل شيئاً للعميل.
            </div>
            <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              سبب الإغلاق *
              <Select value={closureReason} onChange={(e) => setClosureReason(e.target.value)} style={{ width: '100%', marginTop: 5 }}>
                <option value="">اختر السبب</option>
                {Object.entries(CLOSURE_REASONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </Select>
            </label>
            <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              خلاصة ما تم *
              <textarea value={resolutionSummary} onChange={(e) => setResolutionSummary(e.target.value)}
                placeholder="اكتب النتيجة النهائية بشكل يفهمه المدير أو الموظف التالي…"
                style={{ width: '100%', minHeight: 100, resize: 'vertical', marginTop: 5, padding: '9px 10px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'var(--font-sans)' }}/>
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Btn variant="ghost" onClick={() => setClosing(null)} disabled={closureBusy}>إلغاء</Btn>
              <Btn variant="accent" onClick={confirmClosure} disabled={!closureReason || !resolutionSummary.trim() || closureBusy}
                icon={closureBusy ? <Spinner size={13}/> : null}>تأكيد الإغلاق</Btn>
            </div>
          </div>
        </Modal>
      )}

      {bulkOpen && (
        <Modal title={`تحديث ${selected.size} تذكرة`} width={560} onClose={() => !bulkBusy && setBulkOpen(false)}>
          <div className="m-flow" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', padding: '8px 10px', borderRadius: 9, background: 'var(--surface)' }}>
              اترك أي حقل على «بلا تغيير» للحفاظ على قيمته الحالية. تُنفّذ المجموعة كاملة أو لا يُنفّذ شيء.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 9 }}>
              <Select label="الحالة" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
                <option value="">بلا تغيير</option>
                {Object.entries(TICKET_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </Select>
              <Select label="الأولوية" value={bulkPriority} onChange={(e) => setBulkPriority(e.target.value)}>
                <option value="">بلا تغيير</option>
                {Object.entries(TICKET_PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </Select>
              <Select label="المسؤول" value={bulkAssignee} onChange={(e) => setBulkAssignee(e.target.value)}>
                <option value="__keep__">بلا تغيير</option>
                <option value="__clear__">إلغاء الإسناد</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select>
              <Select label="موعد المتابعة" value={bulkFollowupMode} onChange={(e) => setBulkFollowupMode(e.target.value)}>
                <option value="keep">بلا تغيير</option>
                <option value="set">تحديد موعد موحّد</option>
                <option value="clear">إلغاء الموعد</option>
              </Select>
            </div>
            {bulkFollowupMode === 'set' && (
              <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                الموعد الجديد *
                <input type="datetime-local" value={bulkFollowupAt} onChange={(e) => setBulkFollowupAt(e.target.value)}
                  style={{ width: '100%', marginTop: 5, padding: '9px 10px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'var(--font-sans)' }}/>
              </label>
            )}
            {(bulkStatus === 'resolved' || bulkStatus === 'closed') && (
              <>
                <Select label="سبب الإغلاق *" value={bulkClosureReason} onChange={(e) => setBulkClosureReason(e.target.value)}>
                  <option value="">اختر السبب</option>
                  {Object.entries(CLOSURE_REASONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </Select>
                <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  خلاصة الحل المشتركة *
                  <textarea value={bulkResolution} onChange={(e) => setBulkResolution(e.target.value)}
                    placeholder="النتيجة التي تنطبق على جميع التذاكر المحددة…"
                    style={{ width: '100%', minHeight: 76, resize: 'vertical', marginTop: 5, padding: '9px 10px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'var(--font-sans)' }}/>
                </label>
              </>
            )}
            <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              ملاحظة مشتركة للسجل (اختياري)
              <input value={bulkNote} onChange={(e) => setBulkNote(e.target.value)}
                placeholder="مثال: تمت مراجعتها في اجتماع الفريق"
                style={{ width: '100%', marginTop: 5, padding: '9px 10px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'var(--font-sans)' }}/>
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Btn variant="ghost" onClick={() => setBulkOpen(false)} disabled={bulkBusy}>إلغاء</Btn>
              <Btn variant="accent" onClick={applyBulk} disabled={bulkBusy}
                icon={bulkBusy ? <Spinner size={13}/> : <ListChecks size={13}/>}>تطبيق على {selected.size}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
