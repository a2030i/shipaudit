// CrmWorkspace.jsx — وحدة المتابعة/التحصيل + المبيعات (CRM).
//
// 5 تبويبات: قائمة المتابعة · الجهات الخارجية · صفقات المبيعات · المواعيد ·
// أداء التحصيل. بطاقة العميل (drawer) تجمع الـtimeline + الإجراءات السريعة.
// نمط CarriersWorkspace (§1.11f): تبويبات تقرأ ?tab=، داخل PageSlot.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Headset, Store, TrendingUp, CalendarClock, BarChart3, RefreshCw,
  Phone, PhoneCall, StickyNote, HandCoins, UserCog, Plus, ChevronLeft, Upload, Sliders, Trash2 } from 'lucide-react';
import { Card, Btn, Modal, Spinner, Empty, Select, Input, Badge, toast, PageHeader, DropZone } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadLatestReceivables } from '../lib/customerReceivablesService.js';
import { loadCustomerWatch } from '../lib/customer360Service.js';
import { loadEmployees } from '../lib/employeeService.js';
import {
  loadStatuses, loadStages, crmAutoEnroll, loadWatchQueue, ensureCustomerRow,
  logActivity, loadTimeline, recordPromise, resolvePromise, changeStatus, assignOwner,
  loadTasks, createTask, completeTask, loadDeals, createDeal, moveDeal, loadBoardStats,
  upsertStatus, deleteStatus, upsertStage, deleteStage,
} from '../lib/crmService.js';
import { loadLeads, createLead, convertLead, parseLeadsRows, uploadLeadsSnapshot } from '../lib/crmLeadsService.js';
import { effectiveDebt, walletDebtOf } from '../lib/customerRisk.js';
import { loadLatestMerchants } from '../lib/merchantsService.js';

const fmt  = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const daysAgo = (d) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000) : null;

const TABS = [
  { id: 'queue', label: 'قائمة المتابعة', icon: Headset },
  { id: 'sales', label: 'قوائم المبيعات', icon: PhoneCall },
  { id: 'leads', label: 'الجهات الخارجية', icon: Store },
  { id: 'deals', label: 'صفقات المبيعات', icon: TrendingUp },
  { id: 'tasks', label: 'المواعيد', icon: CalendarClock },
  { id: 'board', label: 'أداء التحصيل', icon: BarChart3 },
  { id: 'settings', label: 'الإعدادات', icon: Sliders, perm: 'crm.manage_statuses' },
];
const LEGACY = { '/crm': 'queue' };

export default function CrmWorkspace({ isActive = true }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { can } = useAuth();
  const visibleTabs = TABS.filter(t => !t.perm || can(t.perm));
  const initial = () => {
    const q = new URLSearchParams(location.search).get('tab');
    return (q && TABS.some(t => t.id === q)) ? q : (LEGACY[location.pathname] || 'queue');
  };
  const [tab, setTab] = useState(initial);
  useEffect(() => { if (isActive) setTab(initial()); /* eslint-disable-next-line */ }, [location.search, isActive]);

  const change = (t) => { setTab(t); navigate(`/crm?tab=${t}`, { replace: true }); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', rowGap: 6, padding: '12px 24px 0',
        borderBottom: '1px solid var(--border)', background: 'var(--surface)', position: 'sticky', top: 0, zIndex: 5 }}>
        {visibleTabs.map(t => {
          const Icon = t.icon, active = tab === t.id;
          return (
            <button key={t.id} onClick={() => change(t.id)} style={{
              padding: '10px 18px', border: 'none', background: 'transparent',
              borderBottom: `2.5px solid ${active ? '#06B6D4' : 'transparent'}`,
              color: active ? 'var(--text)' : 'var(--muted)', fontSize: 13, fontWeight: active ? 700 : 500,
              fontFamily: 'var(--font-sans)', cursor: 'pointer', marginBottom: -1,
              display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <Icon size={14}/>{t.label}
            </button>
          );
        })}
      </div>
      <div className="ws-tab-body" style={{ flex: 1, minHeight: 0 }}>
        {tab === 'queue' && <QueueTab active={isActive && tab === 'queue'}/>}
        {tab === 'sales' && <SalesTab active={isActive && tab === 'sales'}/>}
        {tab === 'leads' && <LeadsTab active={isActive && tab === 'leads'}/>}
        {tab === 'deals' && <DealsTab active={isActive && tab === 'deals'}/>}
        {tab === 'tasks' && <TasksTab active={isActive && tab === 'tasks'}/>}
        {tab === 'board' && <BoardTab active={isActive && tab === 'board'}/>}
        {tab === 'settings' && can('crm.manage_statuses') && <SettingsTab active={isActive && tab === 'settings'}/>}
      </div>
    </div>
  );
}

// ═══════════════ قائمة المتابعة ═══════════════
function QueueTab({ active }) {
  const { user, can } = useAuth();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [enrollMsg, setEnrollMsg] = useState('');
  const [sel, setSel] = useState(null); // العميل المفتوح في الـdrawer

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // العملاء المُصنَّفون (شذوذ/متعثّرون) — نفس مصدر لوحة القرارات. وسمهم
      // بمجموعة الشذوذ ليتعرّف crmAutoEnroll على سبب المتابعة.
      const watch = await loadCustomerWatch();
      const seen = new Set(); const customers = [];
      for (const [group, list] of Object.entries(watch?.anomalies || {})) {
        for (const c of (list || [])) {
          if (seen.has(c.name)) continue;
          seen.add(c.name);
          customers.push({ ...c, anomaly: c.anomaly || group });
        }
      }
      const enr = await crmAutoEnroll({ customers, userId: user?.id });
      if (enr.enrolled) setEnrollMsg(`أُضيف ${enr.enrolled} عميل للمتابعة آلياً`);
      const queue = await loadWatchQueue({ customers });
      setRows(queue);
    } catch (e) { toast(`فشل التحميل: ${e.message}`, 'error'); }
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { if (active) refresh(); }, [active, refresh]);

  if (!can('crm.view')) return <Pad><Empty icon="🔒" title="لا صلاحية" sub="تحتاج صلاحية عرض المتابعة"/></Pad>;

  return (
    <Pad>
      <PageHeader icon={<Headset size={22}/>} title="قائمة المتابعة"
        subtitle="العملاء غير النشطين/المتعثّرين — يدخلون آلياً، مرتّبون بالخطر"
        actions={<Btn size="sm" variant="ghost" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/></Btn>}/>
      {enrollMsg && <div style={{ background: '#06B6D415', color: '#0891B2', padding: '8px 14px', borderRadius: 10, fontSize: 13, marginBottom: 12 }}>✅ {enrollMsg}</div>}
      {loading && !rows.length ? <Spin/> : !rows.length ? <Empty icon="✅" title="لا متابعات" sub="لا عملاء يحتاجون متابعة الآن"/> : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <table className="m-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: 'var(--surface2)', textAlign: 'right' }}>
              {['العميل', 'الدين', 'العمر', 'الخطر', 'الحالة', 'آخر لمسة', 'الإجراء التالي'].map(h =>
                <th key={h} style={{ padding: '10px 12px', fontSize: 11.5, color: 'var(--muted)', fontWeight: 600 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map(r => {
                const stale = daysAgo(r.last_activity_at);
                return (
                  <tr key={r.customer_name} onClick={() => setSel(r)} style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}>
                    <td data-label="العميل" style={{ padding: '10px 12px', fontWeight: 600 }}>{r.merchant?.storeName || r.customer_name}</td>
                    <td data-label="الدين" style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)' }}>
                      {fmt(effectiveDebt(r))}
                      {walletDebtOf(r) > 0 && <span title="رصيد محفظة سالب (النظام الداخلي)" style={{ color: '#DC2626', fontSize: 10, marginRight: 4 }}>◆</span>}
                    </td>
                    <td data-label="العمر" style={{ padding: '10px 12px' }}>{r.daysOutstanding || 0} يوم</td>
                    <td data-label="الخطر" style={{ padding: '10px 12px' }}>
                      <span style={{ background: `${r.risk.level.color}20`, color: r.risk.level.color, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{r.risk.level.label} {r.risk.score}</span>
                    </td>
                    <td data-label="الحالة" style={{ padding: '10px 12px' }}>
                      {r.status && <span style={{ background: `${r.status.color}20`, color: r.status.color, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>{r.status.label_ar}</span>}
                    </td>
                    <td data-label="آخر لمسة" style={{ padding: '10px 12px', color: stale > 7 ? '#DC2626' : 'var(--muted)' }}>{stale == null ? '—' : `${stale}ي`}</td>
                    <td data-label="الإجراء التالي" style={{ padding: '10px 12px', color: 'var(--muted)' }}>{fmtDate(r.next_action_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {sel && <CustomerDrawer customer={sel} onClose={() => setSel(null)} onChanged={refresh}/>}
    </Pad>
  );
}

// ═══════════════ بطاقة العميل (drawer) — timeline + إجراءات ═══════════════
function CustomerDrawer({ customer, onClose, onChanged }) {
  const { user, can } = useAuth();
  const name = customer.customer_name;
  const [timeline, setTimeline] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ mode: null }); // call|note|promise|status|assign|task

  const reload = useCallback(async () => {
    try {
      await ensureCustomerRow(name);
      const [tl, st, emp] = await Promise.all([
        loadTimeline({ entityType: 'customer', entityRef: name }),
        loadStatuses(),
        loadEmployees().catch(() => []),
      ]);
      setTimeline(tl); setStatuses(st); setEmployees(emp);
    } catch (e) { toast(e.message, 'error'); }
  }, [name]);
  useEffect(() => { reload(); }, [reload]);

  const act = async (fn, ok) => {
    setBusy(true);
    try { await fn(); toast(ok, 'success'); setForm({ mode: null }); await reload(); onChanged?.(); }
    catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  const KIND_ICON = { call: '📞', whatsapp: '💬', note: '📝', promise: '🤝', status_change: '🔄', stage_change: '📈', system: '⚙️', visit: '🚶', meeting: '👥', reminder: '⏰' };

  return (
    <Modal title={customer.merchant?.storeName || name} onClose={onClose} width={640}>
      {/* رأس */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 4, fontSize: 13 }}>
        <Hd label="الدين" value={`${fmt(effectiveDebt(customer))} ر.س`} color="#DC2626"/>
        <Hd label="العمر" value={`${customer.daysOutstanding || 0} يوم`}/>
        {customer.risk && <Hd label="الخطر" value={`${customer.risk?.level?.label || '—'} (${customer.risk?.score || 0})`} color={customer.risk?.level?.color}/>}
        {customer.merchant?.phone && <Hd label="الجوال" value={<PhoneLink phone={customer.merchant.phone}/>}/>}
      </div>
      {/* جانب المبيعات — كان في customer.merchant دون عرض: نشاط المتجر بنظرة */}
      {customer.merchant && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 4, fontSize: 13 }}>
          <Hd label="شحناته" value={fmt0(customer.merchant.shipmentCount ?? 0)}/>
          <Hd label="آخر شحنة" value={fmtDate(customer.merchant.lastShipmentAt)}/>
          {customer.merchant.billingType && <Hd label="الدفع" value={customer.merchant.billingType}/>}
          {customer.merchant.platformStatus && <Hd label="المنصّة" value={customer.merchant.platformStatus}
            color={customer.merchant.platformStatus === 'نشط' ? 'var(--green2)' : '#DC2626'}/>}
          {customer.merchant.walletBalance != null && <Hd label="المحفظة" value={fmt(customer.merchant.walletBalance)}
            color={Number(customer.merchant.walletBalance) < 0 ? '#DC2626' : undefined}/>}
        </div>
      )}
      {walletDebtOf(customer) > 0 && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
          منها فواتير زوهو <b>{fmt(customer.total)}</b> · محفظة سالبة (النظام الداخلي) <b style={{ color: '#DC2626' }}>{fmt(walletDebtOf(customer))}</b>
        </div>
      )}
      {/* لماذا هذه الدرجة؟ — computeRisk يرجع الأسباب وكانت تُهمَل */}
      {customer.risk?.reasons?.length > 0 && (
        <details style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>
          <summary style={{ cursor: 'pointer' }}>لماذا درجة الخطر {customer.risk.score}؟</summary>
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {customer.risk.reasons.map((r, i) => <div key={i}>• {r.label} <span style={{ color: 'var(--muted2)' }}>(+{r.points})</span></div>)}
          </div>
        </details>
      )}
      <div style={{ marginBottom: 10 }}/>

      {/* أزرار الإجراء */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {can('crm.log_activity') && <Btn size="sm" variant="ghost" icon={<Phone size={13}/>} onClick={() => setForm({ mode: 'call', disposition: 'reached', body: '' })}>مكالمة</Btn>}
        {can('crm.log_activity') && <Btn size="sm" variant="ghost" icon={<StickyNote size={13}/>} onClick={() => setForm({ mode: 'note', body: '' })}>ملاحظة</Btn>}
        {can('crm.record_promise') && <Btn size="sm" variant="accent" icon={<HandCoins size={13}/>} onClick={() => setForm({ mode: 'promise', amount: '', date: '' })}>وعد بالدفع</Btn>}
        {can('crm.change_status') && <Btn size="sm" variant="ghost" onClick={() => setForm({ mode: 'status', statusId: customer.followup_status_id || '' })}>تغيير الحالة</Btn>}
        {can('crm.manage_tasks') && <Btn size="sm" variant="ghost" icon={<CalendarClock size={13}/>} onClick={() => setForm({ mode: 'task', title: '', due: '' })}>موعد</Btn>}
        {can('crm.assign') && <Btn size="sm" variant="ghost" icon={<UserCog size={13}/>} onClick={() => setForm({ mode: 'assign', ownerId: customer.owner_id || '' })}>إسناد</Btn>}
      </div>

      {/* نموذج الإجراء النشط */}
      {form.mode && (
        <Card style={{ background: 'var(--surface2)', marginBottom: 14, padding: 14 }}>
          {form.mode === 'call' && <>
            <Select label="نتيجة المكالمة" value={form.disposition} onChange={e => setForm({ ...form, disposition: e.target.value })}>
              <option value="reached">تواصلت</option><option value="no_answer">لا ردّ</option>
              <option value="promised">وعد بالدفع</option><option value="disputed">نزاع</option><option value="refused">رفض</option>
            </Select>
            <Input label="ملاحظة" value={form.body} onChange={e => setForm({ ...form, body: e.target.value })}/>
            <Btn size="sm" variant="accent" disabled={busy} onClick={() => act(() => logActivity({ entityType: 'customer', entityRef: name, kind: 'call', disposition: form.disposition, summary: `مكالمة: ${form.disposition}`, body: form.body, userId: user?.id }), 'سُجّلت المكالمة')}>حفظ</Btn>
          </>}
          {form.mode === 'note' && <>
            <Input label="الإفادة/الملاحظة" value={form.body} onChange={e => setForm({ ...form, body: e.target.value })}/>
            <Btn size="sm" variant="accent" disabled={busy || !form.body} onClick={() => act(() => logActivity({ entityType: 'customer', entityRef: name, kind: 'note', summary: form.body.slice(0, 60), body: form.body, userId: user?.id }), 'حُفظت الملاحظة')}>حفظ</Btn>
          </>}
          {form.mode === 'promise' && <>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input label="المبلغ" type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}/>
              <Input label="تاريخ الوعد" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })}/>
            </div>
            <Btn size="sm" variant="accent" disabled={busy || !form.amount || !form.date} onClick={() => act(() => recordPromise({ entityRef: name, amount: form.amount, date: form.date, userId: user?.id }), 'سُجّل الوعد')}>حفظ</Btn>
          </>}
          {form.mode === 'status' && <>
            <Select label="الحالة" value={form.statusId} onChange={e => setForm({ ...form, statusId: e.target.value })}>
              <option value="">— اختر —</option>
              {statuses.map(s => <option key={s.id} value={s.id}>{s.label_ar}</option>)}
            </Select>
            <Btn size="sm" variant="accent" disabled={busy || !form.statusId} onClick={() => act(() => changeStatus({ customerName: name, statusId: form.statusId, userId: user?.id }), 'تغيّرت الحالة')}>حفظ</Btn>
          </>}
          {form.mode === 'task' && <>
            <Input label="عنوان الموعد" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}/>
            <Input label="موعد التنفيذ" type="datetime-local" value={form.due} onChange={e => setForm({ ...form, due: e.target.value })}/>
            <Btn size="sm" variant="accent" disabled={busy || !form.title || !form.due} onClick={() => act(() => createTask({ entityType: 'customer', entityRef: name, title: form.title, dueAt: new Date(form.due).toISOString(), assignedTo: customer.owner_id || user?.id, userId: user?.id }), 'أُنشئ الموعد')}>حفظ</Btn>
          </>}
          {form.mode === 'assign' && <>
            <Select label="المُسنَد إليه" value={form.ownerId} onChange={e => setForm({ ...form, ownerId: e.target.value })}>
              <option value="">— اختر موظف —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name || e.email}</option>)}
            </Select>
            <Btn size="sm" variant="accent" disabled={busy || !form.ownerId} onClick={() => act(() => assignOwner({ entityType: 'customer', entityRef: name, ownerId: form.ownerId, ownerName: employees.find(e => e.id === form.ownerId)?.name, userId: user?.id }), 'تم الإسناد')}>حفظ</Btn>
          </>}
        </Card>
      )}

      {/* الـtimeline */}
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>السجلّ الزمني</div>
      {!timeline.length ? <Empty icon="🕓" title="لا نشاطات بعد"/> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
          {timeline.map(a => (
            <div key={a.id} style={{ display: 'flex', gap: 10, padding: '8px 10px', background: 'var(--surface2)', borderRadius: 8 }}>
              <span style={{ fontSize: 16 }}>{KIND_ICON[a.kind] || '•'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{a.summary || a.kind}{a.disposition ? ` · ${a.disposition}` : ''}</div>
                {a.body && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{a.body}</div>}
                {a.kind === 'promise' && <div style={{ fontSize: 11.5, color: '#F59E0B', marginTop: 2 }}>وعد {fmt(a.promise_amount)} ر.س — {fmtDate(a.promised_on)} · {a.promise_status}</div>}
                {a.kind === 'promise' && a.promise_status === 'open' && can('crm.record_promise') && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <Btn size="sm" variant="accent" onClick={() => act(() => resolvePromise(a.id, { status: 'kept', keptAmount: a.promise_amount }), 'سُجّل الدفع')}>تم الدفع</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => act(() => resolvePromise(a.id, { status: 'partial' }), 'سُجّل جزئياً')}>جزئي</Btn>
                    <Btn size="sm" variant="danger" onClick={() => act(() => resolvePromise(a.id, { status: 'broken' }), 'وُسِم مكسوراً')}>مكسور</Btn>
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--muted2,#9CA3AF)', marginTop: 2 }}>{fmtDate(a.occurred_at)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ═══════════════ قوائم عمل المبيعات ═══════════════
// «مين محتمل ومين وقف ومين سجّل ما اشتغل» — ثلاث قوائم اتصال جاهزة من بيانات
// merchants الموجودة (بلا جداول جديدة). النقر يفتح بطاقة العميل نفسها
// (timeline + مكالمة + موعد) — نفس أدوات التحصيل تخدم المبيعات.
const DAY_MS = 86_400_000;
const SALES_LISTS = [
  { id: 'signup',  label: '🆕 سجّل وما شحن',      hint: 'متجر نشط بلا أي شحنة — مكالمة تفعيل',            dateLabel: 'سجّل' },
  { id: 'churned', label: '📴 توقّف عن الشحن',     hint: 'موقوف بالمنصّة وكان يشحن — مكالمة استرجاع',       dateLabel: 'آخر شحنة' },
  { id: 'dormant', label: '😴 نشط وخامل +45ي',    hint: 'نشط لكن آخر شحنة قبل +45 يوم — مكالمة إنعاش',     dateLabel: 'آخر شحنة' },
];
function SalesTab({ active }) {
  const { can } = useAuth();
  const [merchants, setMerchants] = useState(null);
  const [loading, setLoading] = useState(false);
  const [listId, setListId] = useState('signup');
  const [sel, setSel] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await loadLatestMerchants();
      setMerchants(res?.merchants || []);
    } catch (e) { toast(`فشل تحميل المتاجر: ${e.message}`, 'error'); }
    setLoading(false);
  }, []);
  useEffect(() => { if (active && merchants == null) refresh(); }, [active, merchants, refresh]);

  const lists = useMemo(() => {
    const rows = merchants || [];
    const now = Date.now();
    return {
      signup: rows
        .filter(m => (m.shipment_count || 0) === 0 && m.status === 'نشط')
        .sort((a, b) => new Date(b.created_at_platform || 0) - new Date(a.created_at_platform || 0)),
      churned: rows
        .filter(m => m.status === 'غير نشط' && (m.shipment_count || 0) > 0)
        .sort((a, b) => new Date(b.last_shipment_at || 0) - new Date(a.last_shipment_at || 0)),
      dormant: rows
        .filter(m => m.status === 'نشط' && (m.shipment_count || 0) > 0 && m.last_shipment_at
          && (now - new Date(m.last_shipment_at).getTime()) > 45 * DAY_MS)
        .sort((a, b) => (b.shipment_count || 0) - (a.shipment_count || 0)),
    };
  }, [merchants]);

  if (!can('crm.view')) return <Pad><Empty icon="🔒" title="لا صلاحية"/></Pad>;
  const meta = SALES_LISTS.find(l => l.id === listId);
  const rows = lists[listId] || [];

  // يفتح بطاقة العميل بكائن merchant مركَّب — نفس شكل c.merchant في المتابعة
  const openCard = (m) => setSel({
    customer_name: m.store_name,
    total: 0, daysOutstanding: 0,
    merchant: {
      storeId: m.store_id, storeName: m.store_name, phone: m.phone,
      billingType: m.billing_type, platformStatus: m.status,
      shipmentCount: m.shipment_count, lastShipmentAt: m.last_shipment_at,
      walletBalance: m.wallet_balance,
    },
  });

  return (
    <Pad>
      <PageHeader icon={<PhoneCall size={22}/>} title="قوائم المبيعات"
        subtitle="قوائم اتصال جاهزة من كشف المتاجر — تفعيل · استرجاع · إنعاش"
        actions={<Btn size="sm" variant="ghost" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/></Btn>}/>

      {/* مبدّل القوائم مع عدّاداتها */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        {SALES_LISTS.map(l => (
          <Btn key={l.id} size="sm" variant={listId === l.id ? 'primary' : 'outline'} onClick={() => setListId(l.id)}>
            {l.label} ({(lists[l.id] || []).length})
          </Btn>
        ))}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{meta.hint}</div>

      {loading && merchants == null ? <Spin/> : !rows.length
        ? <Empty icon="✅" title="القائمة فارغة" sub={merchants?.length ? 'لا متاجر في هذا التصنيف' : 'ارفع كشف المتاجر من صفحة العملاء ← متاجر المنصّة'}/>
        : (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <table className="m-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: 'var(--surface2)', textAlign: 'right' }}>
                {['المتجر', 'الجوال', meta.dateLabel, 'شحناته', 'المحفظة', 'الدفع', ''].map(h =>
                  <th key={h} style={{ padding: '10px 12px', fontSize: 11.5, color: 'var(--muted)', fontWeight: 600 }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.slice(0, 300).map(m => (
                  <tr key={m.store_id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td data-label="" style={{ padding: '10px 12px', fontWeight: 600, cursor: 'pointer' }} onClick={() => openCard(m)}>{m.store_name}</td>
                    <td data-label="الجوال" style={{ padding: '10px 12px' }}><PhoneLink phone={m.phone}/></td>
                    <td data-label={meta.dateLabel} style={{ padding: '10px 12px', color: 'var(--muted)', fontSize: 12 }}>
                      {fmtDate(listId === 'signup' ? m.created_at_platform : m.last_shipment_at)}
                    </td>
                    <td data-label="شحناته" style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)' }}>{fmt0(m.shipment_count)}</td>
                    <td data-label="المحفظة" style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', color: Number(m.wallet_balance) < 0 ? '#DC2626' : 'var(--text2)' }}>
                      {fmt(m.wallet_balance)}
                    </td>
                    <td data-label="الدفع" style={{ padding: '10px 12px', fontSize: 12, color: 'var(--muted)' }}>{m.billing_type || '—'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <Btn size="sm" variant="ghost" icon={<Phone size={13}/>} onClick={() => openCard(m)}>سجّل تواصلاً</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 300 && <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--muted)' }}>عرض أول 300 من {rows.length} — القوائم مرتّبة بالأولوية</div>}
          </Card>
        )}
      {sel && <CustomerDrawer customer={sel} onClose={() => setSel(null)} onChanged={() => {}}/>}
    </Pad>
  );
}

// جوال قابل للنقر: اتصال مباشر + واتساب
function PhoneLink({ phone }) {
  if (!phone) return '—';
  const digits = String(phone).replace(/\D/g, '');
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
      <a href={`tel:+${digits}`} style={{ color: 'var(--accent)', textDecoration: 'none' }} onClick={e => e.stopPropagation()}>{phone}</a>
      <a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" title="واتساب" onClick={e => e.stopPropagation()} style={{ textDecoration: 'none' }}>💬</a>
    </span>
  );
}

// ═══════════════ الجهات الخارجية (leads) ═══════════════
function LeadsTab({ active }) {
  const { user, can } = useAuth();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(null); // 'upload' | 'new'

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setLeads(await loadLeads()); } catch (e) { toast(e.message, 'error'); }
    setLoading(false);
  }, []);
  useEffect(() => { if (active) refresh(); }, [active, refresh]);

  const onFile = async (file) => {
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
      const parsed = parseLeadsRows(rows);
      const custNames = (await loadLatestReceivables().catch(() => ({ rows: [] }))).rows.map(c => c.name);
      const res = await uploadLeadsSnapshot({ rows: parsed, userId: user?.id, existingCustomerNames: custNames });
      toast(`أُضيف ${res.added} جهة · تُخطّي ${res.skipped} (مكرّر/عميل موجود)`, 'success');
      setModal(null); refresh();
    } catch (e) { toast(`فشل الرفع: ${e.message}`, 'error'); }
  };

  if (!can('crm.view')) return <Pad><Empty icon="🔒" title="لا صلاحية"/></Pad>;
  return (
    <Pad>
      <PageHeader icon={<Store size={22}/>} title="الجهات الخارجية" subtitle="متاجر/جهات للتواصل والمبيعات — خارج العملاء الحاليين"
        actions={<>
          {can('crm.upload_leads') && <Btn size="sm" variant="ghost" icon={<Upload size={14}/>} onClick={() => setModal('upload')}>رفع ملف</Btn>}
          {can('crm.upload_leads') && <Btn size="sm" icon={<Plus size={14}/>} onClick={() => setModal('new')}>جهة جديدة</Btn>}
        </>}/>
      {loading && !leads.length ? <Spin/> : !leads.length ? <Empty icon="🏪" title="لا جهات" sub="ارفع ملف متاجر أو أضف جهة يدوياً"/> : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <table className="m-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: 'var(--surface2)', textAlign: 'right' }}>
              {['الجهة', 'الجوال', 'المدينة', 'الحالة', ''].map(h => <th key={h} style={{ padding: '10px 12px', fontSize: 11.5, color: 'var(--muted)' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {leads.map(l => (
                <tr key={l.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td data-label="الجهة" style={{ padding: '10px 12px', fontWeight: 600 }}>{l.name}</td>
                  <td data-label="الجوال" style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)' }}>{l.phone || '—'}</td>
                  <td data-label="المدينة" style={{ padding: '10px 12px' }}>{l.city || '—'}</td>
                  <td data-label="الحالة" style={{ padding: '10px 12px' }}>
                    <Badge status={l.status === 'converted' ? 'ok' : 'pending'}
                      label={{ new: 'جديد', contacted: 'تم التواصل', qualified: 'مؤهّل', converted: 'تحوّل لعميل', lost: 'مفقود' }[l.status] || l.status}/>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {l.status !== 'converted' && can('crm.convert_lead') &&
                      <Btn size="sm" variant="ghost" onClick={async () => { await convertLead(l.id, { customerName: l.name }); toast('حُوّلت لعميل', 'success'); refresh(); }}>تحويل لعميل</Btn>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {modal === 'upload' && <Modal title="رفع متاجر/جهات" onClose={() => setModal(null)} width={460}>
        <DropZone onFile={onFile} title="اختر ملف Excel" hint="أعمدة: الاسم/المتجر · الجوال · المدينة · ملاحظات"/>
      </Modal>}
      {modal === 'new' && <NewLeadModal onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} userId={user?.id}/>}
    </Pad>
  );
}

function NewLeadModal({ onClose, onSaved, userId }) {
  const [f, setF] = useState({ name: '', phone: '', city: '', notes: '' });
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="جهة جديدة" onClose={onClose} width={440}>
      <Input label="اسم المتجر/الجهة" value={f.name} onChange={e => setF({ ...f, name: e.target.value })}/>
      <Input label="الجوال" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })}/>
      <Input label="المدينة" value={f.city} onChange={e => setF({ ...f, city: e.target.value })}/>
      <Input label="ملاحظات" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })}/>
      <Btn variant="accent" disabled={busy || !f.name} onClick={async () => { setBusy(true); try { await createLead({ ...f, ownerId: userId, userId }); toast('أُضيفت', 'success'); onSaved(); } catch (e) { toast(e.message, 'error'); } setBusy(false); }}>حفظ</Btn>
    </Modal>
  );
}

// ═══════════════ صفقات المبيعات (pipeline) ═══════════════
function DealsTab({ active }) {
  const { user, can } = useAuth();
  const [deals, setDeals] = useState([]);
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { const [d, s] = await Promise.all([loadDeals({ status: 'open' }), loadStages()]); setDeals(d); setStages(s); }
    catch (e) { toast(e.message, 'error'); }
    setLoading(false);
  }, []);
  useEffect(() => { if (active) refresh(); }, [active, refresh]);

  if (!can('crm.view')) return <Pad><Empty icon="🔒" title="لا صلاحية"/></Pad>;
  const openStages = stages.filter(s => !s.is_won && !s.is_lost);
  return (
    <Pad>
      <PageHeader icon={<TrendingUp size={22}/>} title="صفقات المبيعات" subtitle="pipeline الفرص — انقل الصفقة عبر قائمة المرحلة داخل البطاقة"
        actions={can('crm.manage_deals') && <Btn size="sm" icon={<Plus size={14}/>} onClick={() => setModal(true)}>صفقة جديدة</Btn>}/>
      {loading && !deals.length ? <Spin/> : (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(openStages.length, 1)}, minmax(180px, 1fr))`, gap: 10, overflowX: 'auto' }}>
          {openStages.map(st => {
            const col = deals.filter(d => d.stage_id === st.id);
            const total = col.reduce((s, d) => s + (Number(d.value) || 0), 0);
            return (
              <div key={st.id} style={{ background: 'var(--surface2)', borderRadius: 10, padding: 8, minHeight: 120 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: st.color, marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{st.label_ar}</span><span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{fmt0(total)}</span>
                </div>
                {col.map(d => (
                  <Card key={d.id} style={{ padding: 10, marginBottom: 6 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{d.title}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', margin: '2px 0' }}>{fmt(d.value)} ر.س · {d.entity_ref}</div>
                    {can('crm.manage_deals') && <Select style={{ marginTop: 4 }} value={d.stage_id} onChange={async e => { await moveDeal(d.id, e.target.value, { userId: user?.id }); refresh(); }}>
                      {stages.map(s => <option key={s.id} value={s.id}>{s.label_ar}</option>)}
                    </Select>}
                  </Card>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {modal && <NewDealModal stages={stages} onClose={() => setModal(false)} onSaved={() => { setModal(false); refresh(); }} userId={user?.id}/>}
    </Pad>
  );
}

function NewDealModal({ stages, onClose, onSaved, userId }) {
  const [f, setF] = useState({ title: '', entityRef: '', value: '', stageId: stages[0]?.id || '' });
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="صفقة جديدة" onClose={onClose} width={460}>
      <Input label="عنوان الصفقة" value={f.title} onChange={e => setF({ ...f, title: e.target.value })}/>
      <Input label="الجهة/العميل (اسم)" value={f.entityRef} onChange={e => setF({ ...f, entityRef: e.target.value })}/>
      <Input label="القيمة المتوقّعة (ر.س)" type="number" value={f.value} onChange={e => setF({ ...f, value: e.target.value })}/>
      <Select label="المرحلة" value={f.stageId} onChange={e => setF({ ...f, stageId: e.target.value })}>
        {stages.map(s => <option key={s.id} value={s.id}>{s.label_ar}</option>)}
      </Select>
      <Btn variant="accent" disabled={busy || !f.title || !f.entityRef} onClick={async () => { setBusy(true); try { await createDeal({ title: f.title, entityType: 'lead', entityRef: f.entityRef, stageId: f.stageId, value: f.value, ownerId: userId, userId }); toast('أُنشئت الصفقة', 'success'); onSaved(); } catch (e) { toast(e.message, 'error'); } setBusy(false); }}>حفظ</Btn>
    </Modal>
  );
}

// ═══════════════ المواعيد ═══════════════
function TasksTab({ active }) {
  const { user, can } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setTasks(await loadTasks({ assignee: can('crm.view_all') ? null : user?.id, openOnly: true })); }
    catch (e) { toast(e.message, 'error'); }
    setLoading(false);
  }, [user?.id, can]);
  useEffect(() => { if (active) refresh(); }, [active, refresh]);

  if (!can('crm.view')) return <Pad><Empty icon="🔒" title="لا صلاحية"/></Pad>;
  const now = Date.now();
  return (
    <Pad>
      <PageHeader icon={<CalendarClock size={22}/>} title="المواعيد" subtitle="مهامك المجدوَلة — مرتّبة بالاستحقاق"
        actions={<Btn size="sm" variant="ghost" onClick={refresh}><RefreshCw size={14}/></Btn>}/>
      {loading && !tasks.length ? <Spin/> : !tasks.length ? <Empty icon="⏰" title="لا مواعيد" sub="لا مهام مجدوَلة"/> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tasks.map(t => {
            const overdue = new Date(t.due_at).getTime() < now;
            return (
              <Card key={t.id} style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, borderRight: `3px solid ${overdue ? '#DC2626' : '#06B6D4'}` }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{t.title}</div>
                  <div style={{ fontSize: 11.5, color: overdue ? '#DC2626' : 'var(--muted)' }}>{t.entity_ref} · {fmtDate(t.due_at)} {overdue ? '· متأخّر' : ''}</div>
                </div>
                {can('crm.manage_tasks') && <Btn size="sm" variant="ghost" onClick={async () => { await completeTask(t.id, user?.id); refresh(); }}>إنهاء</Btn>}
              </Card>
            );
          })}
        </div>
      )}
    </Pad>
  );
}

// ═══════════════ أداء التحصيل (board) ═══════════════
function BoardTab({ active }) {
  const { can } = useAuth();
  const [s, setS] = useState(null);
  useEffect(() => { if (active) loadBoardStats().then(setS).catch(e => toast(e.message, 'error')); }, [active]);
  if (!can('crm.view')) return <Pad><Empty icon="🔒" title="لا صلاحية"/></Pad>;
  if (!s) return <Pad><Spin/></Pad>;
  const cards = [
    { l: 'لمسات هذا الأسبوع', v: s.touchesThisWeek, c: '#06B6D4' },
    { l: 'وعود نشطة', v: s.promisesOpen, c: '#F59E0B' },
    { l: 'وعود محقّقة', v: s.promisesKept, c: '#10B981' },
    { l: 'وعود مكسورة', v: s.promisesBroken, c: '#DC2626' },
    { l: 'صفقات مفتوحة', v: s.dealsOpenCount, c: '#8B5CF6' },
    { l: 'قيمة الـpipeline', v: `${fmt0(s.pipelineValue)} ر.س`, c: '#3B82F6' },
  ];
  return (
    <Pad>
      <PageHeader icon={<BarChart3 size={22}/>} title="أداء التحصيل والمبيعات"/>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {cards.map(c => (
          <Card key={c.l} style={{ borderTop: `3px solid ${c.c}` }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.l}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: c.c, fontFamily: 'var(--font-mono)', marginTop: 4 }}>{c.v}</div>
          </Card>
        ))}
      </div>
    </Pad>
  );
}

// ═══════════════ الإعدادات: تحرير الحالات/المراحل ═══════════════
function SettingsTab({ active }) {
  const [statuses, setStatuses] = useState([]);
  const [stages, setStages] = useState([]);
  const reload = useCallback(async () => {
    try { const [s, g] = await Promise.all([loadStatuses({ force: true }), loadStages({ force: true })]); setStatuses(s); setStages(g); }
    catch (e) { toast(e.message, 'error'); }
  }, []);
  useEffect(() => { if (active) reload(); }, [active, reload]);
  return (
    <Pad>
      <PageHeader icon={<Sliders size={22}/>} title="إعدادات CRM" subtitle="خصّص حالات المتابعة ومراحل البيع — تظهر فوراً في القوائم"/>
      <EditorList title="حالات المتابعة" items={statuses} kind="status" onChange={reload}/>
      <EditorList title="مراحل البيع" items={stages} kind="stage" onChange={reload}/>
    </Pad>
  );
}

function EditorList({ title, items, kind, onChange }) {
  const upsert = kind === 'status' ? upsertStatus : upsertStage;
  const del    = kind === 'status' ? deleteStatus : deleteStage;
  const [add, setAdd] = useState({ label_ar: '', color: '#6B7280' });
  const doAdd = async () => {
    if (!add.label_ar.trim()) return;
    try {
      await upsert({ key: `custom_${Date.now()}`, label_ar: add.label_ar.trim(), color: add.color, sort_order: (items.length + 1) * 10 });
      toast('أُضيف', 'success'); setAdd({ label_ar: '', color: '#6B7280' }); onChange();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Card style={{ marginBottom: 16, padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map(it => <RowEditor key={it.id} item={it} upsert={upsert} del={del} onChange={onChange}/>)}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--border)' }}>
        <input type="color" value={add.color} onChange={e => setAdd({ ...add, color: e.target.value })} style={{ width: 36, height: 32, border: 'none', background: 'none', cursor: 'pointer' }}/>
        <input placeholder="اسم جديد…" value={add.label_ar} onChange={e => setAdd({ ...add, label_ar: e.target.value })}
          style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}/>
        <Btn size="sm" icon={<Plus size={13}/>} disabled={!add.label_ar.trim()} onClick={doAdd}>إضافة</Btn>
      </div>
    </Card>
  );
}

function RowEditor({ item, upsert, del, onChange }) {
  const [v, setV] = useState({ label_ar: item.label_ar, color: item.color, sort_order: item.sort_order });
  const [busy, setBusy] = useState(false);
  const dirty = v.label_ar !== item.label_ar || v.color !== item.color || Number(v.sort_order) !== Number(item.sort_order);
  const save = async () => {
    setBusy(true);
    try { await upsert({ ...item, label_ar: v.label_ar, color: v.color, sort_order: Number(v.sort_order) }); toast('حُفظ', 'success'); onChange(); }
    catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input type="color" value={v.color} onChange={e => setV({ ...v, color: e.target.value })} style={{ width: 32, height: 30, border: 'none', background: 'none', cursor: 'pointer' }}/>
      <input value={v.label_ar} onChange={e => setV({ ...v, label_ar: e.target.value })}
        style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}/>
      <input type="number" value={v.sort_order} onChange={e => setV({ ...v, sort_order: e.target.value })} title="الترتيب"
        style={{ width: 64, padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-mono)' }}/>
      {item.is_terminal && <span style={{ fontSize: 10, color: '#DC2626' }}>منتهية</span>}
      {dirty && <Btn size="sm" variant="accent" disabled={busy} onClick={save}>حفظ</Btn>}
      <Btn size="sm" variant="danger" title="حذف" icon={<Trash2 size={14}/>} onClick={async () => { if (!confirm(`حذف «${item.label_ar}»؟`)) return; try { await del(item.id); toast('حُذف', 'success'); onChange(); } catch (e) { toast(e.message, 'error'); } }}/>
    </div>
  );
}

// helpers
function Pad({ children }) { return <div style={{ padding: '24px 28px 80px', maxWidth: 1120, margin: '0 auto' }}>{children}</div>; }
function Spin() { return <div style={{ padding: 50, textAlign: 'center' }}><Spinner/></div>; }
function Hd({ label, value, color }) { return <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</div><div style={{ fontSize: 14, fontWeight: 700, color: color || 'var(--text)' }}>{value}</div></div>; }
function MiniBtn({ color, label, onClick }) {
  return <button onClick={onClick} style={{ border: `1px solid ${color}`, background: `${color}15`, color, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>{label}</button>;
}
