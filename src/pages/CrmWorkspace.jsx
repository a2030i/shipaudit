// CrmWorkspace.jsx — وحدة المتابعة/التحصيل + المبيعات (CRM).
//
// مساحة مساندة لصفقات المبيعات ومواعيدها وقياس الأداء. «قائمة المتابعة»
// تقاعدت لصالح مركز فرص المنصة كي لا توجد قائمتان للعمل اليومي.
// نمط CarriersWorkspace (§1.11f): تبويبات تقرأ ?tab=، داخل PageSlot.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Headset, Store, TrendingUp, CalendarClock, BarChart3, RefreshCw,
  Phone, PhoneCall, StickyNote, HandCoins, UserCog, Plus, ChevronLeft, Upload, Sliders, Trash2,
  Search, AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react';
import { Card, Btn, Modal, Spinner, Empty, Select, Input, Badge, toast, PageHeader, DropZone } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadCustomerWatch } from '../lib/customer360Service.js';
import { loadEmployees } from '../lib/employeeService.js';
import {
  loadStatuses, loadStages, crmAutoEnroll, loadWatchQueue, ensureCustomerRow,
  logActivity, loadTimeline, recordPromise, resolvePromise, changeStatus, assignOwner,
  loadTasks, createTask, completeTask, loadDeals, createDeal, moveDeal, loadBoardStats,
  upsertStatus, deleteStatus, upsertStage, deleteStage,
} from '../lib/crmService.js';
import {
  loadLeads, createLead, parseLeadsRows, detectLeadColumns, uploadLeadsSnapshot, bulkAssignLeads,
  assignLeadsByIds, updateLead, loadLeadStats, loadLeadOptions, loadLeadsByPhone,
  recordLeadOutcome, closeLead,
} from '../lib/crmLeadsService.js';
import { effectiveDebt, walletDebtOf } from '../lib/customerRisk.js';
import { loadLatestMerchants } from '../lib/merchantsService.js';
import WaActions from '../components/WaActions.jsx';
import WhatsAppSendModal from '../components/WhatsAppSendModal.jsx';
import { normalizeSaudiPhone } from '../lib/whatsappService.js';
import { loadHatifCallCommitments, hatifCommitmentMeta, summarizeHatifCommitments } from '../lib/hatifCommitmentsService.js';
import { saDateTime, saTime } from '../lib/saTime.js';
import { HUDHUD_LEAD_CATEGORIES, loadHudhudCoverage, runHudhudLeadScan, loadHudhudCandidates, approveHudhudCandidate, rejectHudhudCandidate } from '../lib/hudhudLeadDiscoveryService.js';

const fmt  = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const daysAgo = (d) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000) : null;
// خلط عشوائي (Fisher-Yates) — لأخذ عيّنة عشوائية N من نتائج مطابقة للفلاتر.
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const TABS = [
  { id: 'deals', label: 'صفقات المبيعات', icon: TrendingUp },
  { id: 'tasks', label: 'المواعيد', icon: CalendarClock },
  { id: 'board', label: 'أداء المبيعات', icon: BarChart3 },
  { id: 'settings', label: 'الإعدادات', icon: Sliders, perm: 'crm.manage_statuses' },
];
const LEGACY = { '/crm': 'deals' };

export default function CrmWorkspace({ isActive = true }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { can } = useAuth();
  const visibleTabs = TABS.filter(t => !t.perm || can(t.perm));
  const initial = () => {
    const q = new URLSearchParams(location.search).get('tab');
    const normalized = q === 'queue' ? 'deals' : q;
    const want = (normalized && TABS.some(t => t.id === normalized)) ? normalized : (LEGACY[location.pathname] || 'deals');
    // محاسب بلا صلاحية التبويب المطلوب → أول تبويب مرئي له
    return visibleTabs.some(t => t.id === want) ? want : (visibleTabs[0]?.id || 'queue');
  };
  const [tab, setTab] = useState(initial);
  useEffect(() => { if (isActive) setTab(initial()); /* eslint-disable-next-line */ }, [location.search, isActive]);
  // «قوائم المبيعات» تقاعدت لصالح إعادة الاستهداف — توجيه الروابط القديمة
  useEffect(() => {
    if (isActive && new URLSearchParams(location.search).get('tab') === 'sales') navigate('/retargeting', { replace: true });
  }, [isActive, location.search, navigate]);

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
              borderBottom: `2.5px solid ${active ? 'var(--accent3)' : 'transparent'}`,
              color: active ? 'var(--text)' : 'var(--muted)', fontSize: 13, fontWeight: active ? 700 : 500,
              fontFamily: 'var(--font-sans)', cursor: 'pointer', marginBottom: -1,
              display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <Icon size={14}/>{t.label}
            </button>
          );
        })}
      </div>
      <div className="ws-tab-body" style={{ flex: 1, minHeight: 0 }}>
        <div style={{ margin: '12px 24px 0', padding: '9px 13px', borderRadius: 10,
          background: 'color-mix(in srgb, var(--accent3) 7%, var(--surface))',
          border: '1px solid color-mix(in srgb, var(--accent3) 22%, var(--border))',
          color: 'var(--text2)', fontSize: 12.5 }}>
          هذه المساحة للصفقات والمواعيد وقياس الأداء فقط. قائمة الاتصال اليومية والعملاء الجدد والمتوقفون في <b>فرص المنصة</b>؛ وردود واتساب تبقى لدى فريق هاتف.
        </div>
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
        actions={<Btn size="sm" variant="ghost" title="تحديث قائمة المتابعة" ariaLabel="تحديث قائمة المتابعة" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/></Btn>}/>
      {enrollMsg && <div style={{ background: 'color-mix(in srgb, var(--accent3) 8%, transparent)', color: '#0891B2', padding: '8px 14px', borderRadius: 10, fontSize: 13, marginBottom: 12 }}>✅ {enrollMsg}</div>}
      {loading && !rows.length ? <Spin/> : !rows.length ? <Empty icon="✅" title="لا متابعات" sub="لا عملاء يحتاجون متابعة الآن"/> : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <table className="m-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: 'var(--surface2)', textAlign: 'right' }}>
              {['العميل', 'الدين', 'العمر', 'الخطر', 'الحالة', 'آخر تواصل', 'الإجراء التالي'].map(h =>
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
                      {walletDebtOf(r) > 0 && <span title="رصيد محفظة سالب (النظام الداخلي)" style={{ color: 'var(--red)', fontSize: 10, marginRight: 4 }}>◆</span>}
                    </td>
                    <td data-label="العمر" style={{ padding: '10px 12px' }}>{r.daysOutstanding || 0} يوم</td>
                    <td data-label="الخطر" style={{ padding: '10px 12px' }}>
                      <span style={{ background: `${r.risk.level.color}20`, color: r.risk.level.color, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{r.risk.level.label} {r.risk.score}</span>
                    </td>
                    <td data-label="الحالة" style={{ padding: '10px 12px' }}>
                      {r.status && <span style={{ background: `${r.status.color}20`, color: r.status.color, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>{r.status.label_ar}</span>}
                    </td>
                    <td data-label="آخر تواصل" style={{ padding: '10px 12px', color: stale > 7 ? 'var(--red)' : 'var(--muted)' }}>{stale == null ? '—' : `${stale}ي`}</td>
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
        <Hd label="الدين" value={`${fmt(effectiveDebt(customer))} ر.س`} color="var(--red)"/>
        <Hd label="العمر" value={`${customer.daysOutstanding || 0} يوم`}/>
        {customer.risk && <Hd label="الخطر" value={`${customer.risk?.level?.label || '—'} (${customer.risk?.score || 0})`} color={customer.risk?.level?.color}/>}
        {customer.merchant?.phone && <Hd label="الجوال" value={<PhoneLink phone={customer.merchant.phone} name={customer.customer_name || customer.name}/>}/>}
      </div>
      {/* جانب المبيعات — كان في customer.merchant دون عرض: نشاط المتجر بنظرة */}
      {customer.merchant && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 4, fontSize: 13 }}>
          <Hd label="شحناته" value={fmt0(customer.merchant.shipmentCount ?? 0)}/>
          <Hd label="آخر شحنة" value={fmtDate(customer.merchant.lastShipmentAt)}/>
          {customer.merchant.billingType && <Hd label="الدفع" value={customer.merchant.billingType}/>}
          {customer.merchant.platformStatus && <Hd label="المنصّة" value={customer.merchant.platformStatus}
            color={customer.merchant.platformStatus === 'نشط' ? 'var(--green2)' : 'var(--red)'}/>}
          {customer.merchant.walletBalance != null && <Hd label="المحفظة" value={fmt(customer.merchant.walletBalance)}
            color={Number(customer.merchant.walletBalance) < 0 ? 'var(--red)' : undefined}/>}
        </div>
      )}
      {walletDebtOf(customer) > 0 && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
          منها فواتير زوهو <b>{fmt(customer.total)}</b> · محفظة سالبة (النظام الداخلي) <b style={{ color: 'var(--red)' }}>{fmt(walletDebtOf(customer))}</b>
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
                {a.kind === 'promise' && <div style={{ fontSize: 11.5, color: 'var(--gold)', marginTop: 2 }}>وعد {fmt(a.promise_amount)} ر.س — {fmtDate(a.promised_on)} · {a.promise_status}</div>}
                {a.kind === 'promise' && a.promise_status === 'open' && can('crm.record_promise') && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <Btn size="sm" variant="accent" onClick={() => act(() => resolvePromise(a.id, { status: 'kept', keptAmount: a.promise_amount }), 'سُجّل الدفع')}>تم الدفع</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => act(() => resolvePromise(a.id, { status: 'partial' }), 'سُجّل جزئياً')}>جزئي</Btn>
                    <Btn size="sm" variant="danger" onClick={() => act(() => resolvePromise(a.id, { status: 'broken' }), 'وُسم أنه لم يُوفَ')}>لم يُوفَ</Btn>
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
        actions={<Btn size="sm" variant="ghost" title="تحديث صفقات المبيعات" ariaLabel="تحديث صفقات المبيعات" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/></Btn>}/>

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
                    <td data-label="الجوال" style={{ padding: '10px 12px' }}><PhoneLink phone={m.phone} name={m.store_name}/></td>
                    <td data-label={meta.dateLabel} style={{ padding: '10px 12px', color: 'var(--muted)', fontSize: 12 }}>
                      {fmtDate(listId === 'signup' ? m.created_at_platform : m.last_shipment_at)}
                    </td>
                    <td data-label="شحناته" style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)' }}>{fmt0(m.shipment_count)}</td>
                    <td data-label="المحفظة" style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', color: Number(m.wallet_balance) < 0 ? 'var(--red)' : 'var(--text2)' }}>
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

// جوال قابل للنقر: اتصال + إطلاق حملة (الفعل الرئيسي) + محادثة حرّة ثانوية.
// كان wa.me فقط — توحيد §هيكلة-0: كل أيقونة واتساب تفتح حملة قالب مسجَّلة.
function PhoneLink({ phone, name }) {
  if (!phone) return '—';
  const digits = String(phone).replace(/\D/g, '');
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
      <a href={`tel:+${digits}`} style={{ color: 'var(--accent)', textDecoration: 'none' }} onClick={e => e.stopPropagation()}>{phone}</a>
      <WaActions phone={phone} name={name} showTel={false} size={14} campaignLabel="CRM"/>
    </span>
  );
}

function externalUrl(value, kind = 'web') {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (kind === 'instagram') {
    const handle = raw.replace(/^@/, '').replace(/^instagram\.com\//i, '').replace(/^www\.instagram\.com\//i, '');
    if (!handle) return null;
    return `https://instagram.com/${handle.replace(/^\/+/, '')}`;
  }
  return `https://${raw.replace(/^\/+/, '')}`;
}

function compactUrlLabel(value, kind = 'web') {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  if (kind === 'instagram') {
    const handle = raw
      .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
      .replace(/^@/, '')
      .replace(/\/$/, '');
    return handle ? `@${handle}` : 'إنستجرام';
  }
  return raw
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/$/, '');
}

function LeadLink({ value, kind = 'web', empty = '—' }) {
  const href = externalUrl(value, kind);
  if (!href) return empty;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={e => e.stopPropagation()}
      style={{ color: 'var(--blue)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      title={String(value || '')}
    >
      <ExternalLink size={12}/>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{compactUrlLabel(value, kind)}</span>
    </a>
  );
}

function EmailLink({ email }) {
  const v = String(email || '').trim();
  if (!v) return '—';
  return (
    <a
      href={`mailto:${v}`}
      onClick={e => e.stopPropagation()}
      style={{ color: 'var(--blue)', fontWeight: 700, display: 'inline-block', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      title={v}
    >
      {v}
    </a>
  );
}

// ═══════════════ الجهات الخارجية (leads) ═══════════════
export function LeadsTab({ active }) {   // §1.32 مرحلة 3: يُعرَض داخل مركز المبيعات
  const { user, can } = useAuth();
  const [leads, setLeads] = useState([]);
  const [count, setCount] = useState(0);
  const [stats, setStats] = useState(null);
  const [options, setOptions] = useState({ categories: [], platforms: [], statuses: [] });
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(null); // 'upload' | 'new' | 'hudhud'
  const [sel, setSel] = useState(null);
  const [filters, setFilters] = useState({
    q: '',
    status: '',
    leadKind: '',
    ownerId: '',
    category: '',
    platform: '',
    duplicateOnly: false,
    matched: '',          // '' الكل | 'yes' | 'no' (كان checkbox — طلب المستخدم: نعم/لا)
    campaign: '',         // آخر حملة واتساب: '' | none | within7 | within30 | older30
    unassignedOnly: false,
    page: 0,
  });
  // تحديد جماعي → تحويل لموظف دفعة واحدة (طلب المستخدم 2026-07-16)
  const [selIds, setSelIds] = useState(() => new Set());
  const [selAllMatching, setSelAllMatching] = useState(false); // كل النتائج المطابقة (عبر كل الصفحات)
  const [bulkOwner, setBulkOwner] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  // عيّنة عشوائية ضمن الفلاتر (طلب المستخدم 2026-07-26): «13 ألف كثير، ابغا 1000
  // عشوائي ضمن الفلاتر». حقل عدد يقصّ «كل المطابق» لعيّنة عشوائية (0/فارغ = الكل).
  const [sampleN, setSampleN] = useState(1000);
  // إطلاق حملة واتساب من التبويب مباشرة (طلب المستخدم 2026-07-21):
  // للمحدد أو للصفحة المعروضة — عبر WhatsAppSendModal (قالب هاتف مسجَّل §1.29)
  const [waRecipients, setWaRecipients] = useState(null);
  const leadRecipient = (l) => ({
    to: normalizeSaudiPhone(l.phone_normalized || l.phone),
    name: l.name || '',
    vars: [l.name || ''],
    fields: { name: l.name, category: l.category, platform: l.platform, phone: l.phone_normalized || l.phone },
  });
  const launchCampaign = (list) => {
    const recs = list.filter(l => l.phone_normalized || l.phone).map(leadRecipient);
    if (!recs.length) { toast('لا أرقام جوال في القائمة المختارة', 'info'); return; }
    setWaRecipients(recs);
  };
  // إطلاق حملة على **كل** المطابق للفلاتر (لا الصفحة المعروضة فقط) — يجلب صفحات
  // 500 حتى الاكتمال (نفس نمط الإسناد الجماعي/إعادة الاستهداف). طلب المستخدم:
  // «ابغا اطلق حملة للمحددين، يظهر فقط 50 المعروضين».
  const [prepCampaign, setPrepCampaign] = useState(false);
  const launchAllMatching = async () => {
    if (prepCampaign) return;
    setPrepCampaign(true);
    try {
      const all = [];
      for (let page = 0; page < 200; page++) {
        const r = await loadLeads({ ...filters, page, limit: 500, force: true });
        all.push(...(r.rows || []));
        if (!r.rows?.length || all.length >= (r.count || 0)) break;
      }
      let pick = all.filter(l => l.phone_normalized || l.phone);
      // عيّنة عشوائية: نخلط ثم نقصّ N (المستخدم لا يريد كل الـ13 ألف دفعة).
      const n = Number(sampleN) || 0;
      if (n > 0 && pick.length > n) pick = shuffle(pick).slice(0, n);
      const recs = pick.map(leadRecipient);
      if (!recs.length) { toast('لا أرقام جوال بالفلاتر الحالية', 'info'); return; }
      setWaRecipients(recs);
    } catch (e) { toast(`تعذّر تجهيز المستلمين: ${e.message}`, 'error'); }
    finally { setPrepCampaign(false); }
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, leadStats, leadOptions, emp] = await Promise.all([
        loadLeads(filters),
        loadLeadStats().catch(() => null),
        loadLeadOptions().catch(() => ({ categories: [], platforms: [], statuses: [] })),
        loadEmployees().catch(() => []),
      ]);
      setLeads(list.rows || []);
      setCount(list.count || 0);
      setStats(leadStats);
      setOptions(leadOptions);
      setEmployees(emp);
    } catch (e) { toast(e.message, 'error'); }
    setLoading(false);
  }, [filters]);
  useEffect(() => { if (active) refresh(); }, [active, refresh]);

  const setFilter = (patch) => { setFilters(prev => ({ ...prev, ...patch, page: patch.page ?? 0 })); setSelIds(new Set()); setSelAllMatching(false); };

  const assignLead = async (lead, ownerId) => {
    await updateLead(lead.id, { owner_id: ownerId || null });
    toast(ownerId ? 'تم إسناد الجهة المحتملة' : 'أزيل الإسناد', 'success');
    refresh();
  };

  const toggleSel = (id) => setSelIds(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allPageSelected = leads.length > 0 && leads.every(l => selIds.has(l.id));
  const toggleAllPage = () => {
    setSelAllMatching(false);
    setSelIds(prev => {
      const n = new Set(prev);
      if (allPageSelected) leads.forEach(l => n.delete(l.id));
      else leads.forEach(l => n.add(l.id));
      return n;
    });
  };
  const bulkAssign = async () => {
    if (!bulkOwner || (!selIds.size && !selAllMatching)) return;
    const emp = employees.find(e => e.id === bulkOwner);
    // كل النتائج المطابقة (7,004 مثلاً): عملية واحدة على الخادم بنفس الفلاتر —
    // لا حلقة آلاف الطلبات. تأكيد صريح قبل التنفيذ (فعل واسع).
    if (selAllMatching) {
      const sn = Number(sampleN) || 0;
      const sampling = sn > 0 && sn < count;
      const label = sampling ? `عيّنة عشوائية (${fmt0(sn)}) من ${fmt0(count)}` : `كل النتائج المطابقة (${fmt0(count)} جهة)`;
      if (!window.confirm(`تحويل ${label} إلى ${emp?.name || 'الموظف'}؟`)) return;
      setBulkBusy(true);
      try {
        let n;
        if (sampling) {
          // عيّنة عشوائية: نجلب المطابق ثم نخلط ونقصّ ونُسنِد بالمعرّفات المحددة.
          const all = [];
          for (let page = 0; page < 400; page++) {
            const r = await loadLeads({ ...filters, page, limit: 500, force: true });
            all.push(...(r.rows || []));
            if (!r.rows?.length || all.length >= (r.count || 0)) break;
          }
          const ids = shuffle(all).slice(0, sn).map(l => l.id);
          n = await assignLeadsByIds(ids, bulkOwner);
        } else {
          n = await bulkAssignLeads({ ...filters, newOwnerId: bulkOwner });
        }
        toast(`حُوّلت ${fmt0(n)} جهة إلى ${emp?.name || 'الموظف'} ✓`, 'success');
        setSelIds(new Set()); setSelAllMatching(false); setBulkOwner('');
        refresh();
      } catch (e) { toast(`فشل التحويل الجماعي: ${e.message}`, 'error'); }
      setBulkBusy(false);
      return;
    }
    setBulkBusy(true);
    let ok = 0;
    try {
      for (const id of selIds) {
        await updateLead(id, { owner_id: bulkOwner });
        ok++;
      }
      toast(`حُوّلت ${ok} جهة إلى ${emp?.name || 'الموظف'} ✓`, 'success');
      setSelIds(new Set()); setBulkOwner('');
      refresh();
    } catch (e) { toast(`تحوّلت ${ok} ثم فشل: ${e.message}`, 'error'); }
    setBulkBusy(false);
  };

  // تفصيص 2026-07-16: التبويب يعيش في مركز المبيعات على مفتاحه المستقل —
  // كان الحارس crm.view وحدها فظهر التبويب (بمفتاحه الجديد) وداخله «لا صلاحية».
  if (!can('sales.external_leads') && !can('crm.view')) return <Pad><Empty icon="🔒" title="لا صلاحية" sub="تحتاج صلاحية «تبويب عملاء خارج المنصّة»"/></Pad>;
  const totalPages = Math.max(1, Math.ceil(count / 50));  // = PAGE في crmLeadsService
  return (
    <Pad>
      <PageHeader icon={<Store size={22}/>} title="جهات محتملة" subtitle="تنظيف قوائم المتاجر الخارجية، كشف التكرارات، ومطابقة أرقام عملاء المنصّة"
        actions={<>
          <Btn size="sm" variant="ghost" title="تحديث بيانات الصفقة" ariaLabel="تحديث بيانات الصفقة" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/></Btn>
          {/* إطلاق حملة قالب للصفحة المعروضة (المودال يوضّح الصلاحية لمن لا يملكها) */}
          <Btn size="sm" variant="accent" icon={<Phone size={13}/>} onClick={() => launchCampaign(leads)}>
            إطلاق حملة للمعروضين ({leads.filter(l => l.phone_normalized || l.phone).length})
          </Btn>
          {can('crm.upload_leads') && <Btn size="sm" variant="primary" icon={<Upload size={14}/>} onClick={() => setModal('upload')}>رفع وتنظيف Excel</Btn>}
          {(can('sales.external_leads')||can('crm.upload_leads')) && <Btn size="sm" variant="primary" icon={<Store size={14}/>} onClick={() => setModal('hudhud')}>اكتشاف من هدهد</Btn>}
          {can('crm.upload_leads') && <Btn size="sm" icon={<Plus size={14}/>} onClick={() => setModal('new')}>جهة جديدة</Btn>}
        </>}/>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 10, marginBottom: 12 }}>
        <CrmKpi label="إجمالي العملاء المحتملين" value={fmt0(stats?.total || count)} color="var(--accent3)"/>
        <CrmKpi label="مهتمون جدد من الحملات" value={fmt0(stats?.inboundNew || 0)} color="var(--green)"/>
        <CrmKpi label="تجاوزوا مهلة أول اتصال" value={fmt0(stats?.overdueSla || 0)} color="var(--red)"/>
        <CrmKpi label="أرقام مكررة" value={fmt0(stats?.duplicateRows || 0)} color="var(--gold)"/>
        <CrmKpi label="طلعوا عملاء لدينا" value={fmt0(stats?.existingCustomers || 0)} color="var(--accent)"/>
        <CrmKpi label="مهتمون بلا مسؤول" value={fmt0(stats?.inboundUnassigned || 0)} color="var(--red)"/>
      </div>

      <Card style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1.4fr) repeat(4, minmax(130px, 1fr))', gap: 8 }} className="crm-lead-filters">
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', top: 11, insetInlineStart: 11, color: 'var(--muted)' }}/>
            {/* type=search + autoComplete=off + name محايد: كروم كان يظنه حقل بريد
                فيعبّئه بإيميل الحساب تلقائياً عند كل دخول للصفحة (2026-07-16) */}
            <input type="search" name="leads-filter-q" autoComplete="off"
              value={filters.q} onChange={e => setFilter({ q: e.target.value })}
              placeholder="ابحث باسم، رقم 966، بريد، قسم..."
              style={{ width: '100%', padding: '9px 34px 9px 12px', border: '1px solid var(--border2)', borderRadius: 9, background: 'var(--surface)', color: 'var(--text)' }}/>
          </div>
          <Select value={filters.status} onChange={e => setFilter({ status: e.target.value })}>
            <option value="">كل الحالات</option>
            {LEAD_STATUS_OPTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
          <Select value={filters.leadKind} onChange={e => setFilter({ leadKind: e.target.value })}>
            <option value="">كل أنواع الفرص</option>
            <option value="inbound">مهتمون من حملات</option>
            <option value="cold">قوائم استهداف باردة</option>
            <option value="referral">إحالات</option>
          </Select>
          <Select value={filters.ownerId} onChange={e => setFilter({ ownerId: e.target.value, unassignedOnly: false })}>
            <option value="">كل الموظفين</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name || e.email}</option>)}
          </Select>
          <Select value={filters.category} onChange={e => setFilter({ category: e.target.value })}>
            <option value="">كل الأقسام</option>
            {options.categories.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select value={filters.platform} onChange={e => setFilter({ platform: e.target.value })}>
            <option value="">كل المنصات</option>
            {options.platforms.map(p => <option key={p} value={p}>{p}</option>)}
            <option value="__none__">غير سلة ولا زد (بلا منصّة)</option>
          </Select>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--muted)' }}>
            <input type="checkbox" checked={filters.duplicateOnly} onChange={e => setFilter({ duplicateOnly: e.target.checked })}/> أرقام مكررة فقط
          </label>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--muted)' }}>
            موجود في المنصّة؟
            <select value={filters.matched} onChange={e => setFilter({ matched: e.target.value })}
              style={{ padding: '4px 10px', borderRadius: 8, fontSize: 12, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>
              <option value="">الكل</option>
              <option value="yes">نعم — عملاء لدينا</option>
              <option value="no">لا — خارج المنصّة</option>
            </select>
          </label>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--muted)' }}>
            📲 آخر حملة واتساب
            <select value={filters.campaign} onChange={e => setFilter({ campaign: e.target.value })}
              style={{ padding: '4px 10px', borderRadius: 8, fontSize: 12, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>
              <option value="">الكل</option>
              <option value="none">بلا حملة إطلاقاً</option>
              <option value="within7">خلال آخر 7 أيام</option>
              <option value="within30">خلال آخر 30 يوم</option>
              <option value="older30">له حملة أقدم من 30 يوم</option>
            </select>
          </label>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--muted)' }}>
            <input type="checkbox" checked={filters.unassignedOnly} onChange={e => setFilter({ unassignedOnly: e.target.checked, ownerId: '' })}/> بدون موظف
          </label>
          <span style={{ marginInlineStart: 'auto', fontSize: 12, color: 'var(--muted)' }}>
            عرض {leads.length} من {fmt0(count)} جهة محتملة
          </span>
        </div>
      </Card>

      {/* شريط التحويل الجماعي — يظهر عند تحديد أي صف */}
      {can('crm.assign') && (selIds.size > 0 || selAllMatching) && (
        <Card style={{ padding: '10px 14px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', border: '1.5px solid color-mix(in srgb, var(--accent) 35%, var(--border))' }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>
            ✓ {selAllMatching ? `كل النتائج المطابقة (${fmt0(count)})` : `${selIds.size} جهة`} محددة
          </span>
          {/* عيّنة عشوائية ضمن الفلاتر — الحملة/الإسناد تعمل على N عشوائية لا الكل */}
          {selAllMatching && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
              🎲 عيّنة عشوائية:
              <input type="number" min="0" step="100" value={sampleN}
                onChange={e => setSampleN(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0))}
                style={{ width: 78, padding: '5px 8px', borderRadius: 8, fontSize: 12.5, textAlign: 'center', border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text)' }}/>
              <span style={{ fontSize: 11, color: 'var(--muted2)' }}>{Number(sampleN) > 0 ? `من ${fmt0(count)} (0 = الكل)` : 'الكل'}</span>
            </label>
          )}
          {/* الصفحة كلها محددة والنتائج أكثر → عرض تحديد الكل عبر الصفحات */}
          {!selAllMatching && allPageSelected && count > leads.length && (
            <button onClick={() => setSelAllMatching(true)} style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: 'var(--accent)', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-sans)', textDecoration: 'underline',
            }}>
              تحديد كل الـ{fmt0(count)} المطابقة للفلاتر
            </button>
          )}
          <select value={bulkOwner} onChange={e => setBulkOwner(e.target.value)}
            style={{ padding: '6px 12px', borderRadius: 9, fontSize: 12.5, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>
            <option value="">اختر الموظف…</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name || e.email}</option>)}
          </select>
          <Btn size="sm" variant="accent" onClick={bulkAssign} disabled={!bulkOwner || bulkBusy}>
            {bulkBusy ? 'يحوّل…' : `تحويل ${selAllMatching ? fmt0(Number(sampleN) > 0 ? Math.min(Number(sampleN), count) : count) : selIds.size} للموظف`}
          </Btn>
          {/* حملة واتساب للمحدد — الصفحة الحالية أو كل المطابق عند «تحديد الكل» */}
          {selIds.size > 0 && !selAllMatching && (
            <Btn size="sm" variant="ghost" icon={<Phone size={13}/>}
              onClick={() => launchCampaign(leads.filter(l => selIds.has(l.id)))}>
              📲 حملة للمحدد ({leads.filter(l => selIds.has(l.id) && (l.phone_normalized || l.phone)).length})
            </Btn>
          )}
          {selAllMatching && (
            <Btn size="sm" variant="accent" icon={<Phone size={13}/>} onClick={launchAllMatching} disabled={prepCampaign}>
              {prepCampaign ? 'يجهّز المستلمين…'
                : Number(sampleN) > 0
                  ? `📲 حملة لعيّنة عشوائية (${fmt0(Math.min(Number(sampleN), count))})`
                  : `📲 حملة لكل المطابق (${fmt0(count)})`}
            </Btn>
          )}
          <Btn size="sm" variant="ghost" onClick={() => { setSelIds(new Set()); setSelAllMatching(false); }}>إلغاء التحديد</Btn>
        </Card>
      )}

      {loading && !leads.length ? <Spin/> : !leads.length ? <Empty icon="🏪" title="لا جهات" sub="ارفع ملف متاجر أو خفف الفلاتر الحالية"/> : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <table className="m-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: 'var(--surface2)', textAlign: 'right' }}>
              {can('crm.assign') && (
                <th style={{ padding: '10px 12px', width: 34 }}>
                  <input type="checkbox" checked={allPageSelected} onChange={toggleAllPage}
                    title="تحديد كل صفوف الصفحة" style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}/>
                </th>
              )}
              {['المتجر', 'الرقم', 'القسم/المنصة', 'التحقق', 'الموظف', 'الحالة', ''].map(h => <th key={h} style={{ padding: '10px 12px', fontSize: 11.5, color: 'var(--muted)' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {leads.map(l => (
                <tr key={l.id} onClick={() => setSel(l)} style={{ borderTop: '1px solid var(--border)', cursor: 'pointer', background: selIds.has(l.id) ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : undefined }}>
                  {can('crm.assign') && (
                    <td data-label="تحديد" style={{ padding: '10px 12px' }} onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selIds.has(l.id)} onChange={() => toggleSel(l.id)}
                        style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}/>
                    </td>
                  )}
                  <td data-label="المتجر" style={{ padding: '10px 12px', fontWeight: 700 }}>
                    <div>{l.name}</div>
                    {l.name_en && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{l.name_en}</div>}
                    {l.matched_store_name && <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 3 }}>لدينا: {l.matched_store_name}</div>}
                  </td>
                  <td data-label="الرقم" style={{ padding: '10px 12px' }}><PhoneLink phone={l.phone_normalized || l.phone} name={l.name}/></td>
                  <td data-label="القسم/المنصة" style={{ padding: '10px 12px', color: 'var(--muted)', fontSize: 12 }}>
                    <div>{l.category || '—'}</div>
                    {l.platform && <div style={{ marginTop: 2 }}>{l.platform}</div>}
                  </td>
                  <td data-label="التحقق" style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {l.matched_store_id
                        ? <MiniPill color="var(--accent)" icon={<CheckCircle2 size={11}/>} label="عميل لدينا"/>
                        : <MiniPill color="var(--green)" label="خارج المنصّة"/>}
                      {Number(l.duplicate_count) > 1 && <MiniPill color="var(--gold)" icon={<AlertTriangle size={11}/>} label={`${l.duplicate_count} بنفس الرقم`}/>}
                      {l.lead_kind === 'inbound' && <MiniPill color="var(--green)" label={`⚡ مهتم${l.campaign_name ? ` · ${l.campaign_name}` : ''}`}/>}
                      {l.last_campaign_at && (
                        <MiniPill color={l.last_campaign_replied_at ? 'var(--green)' : 'var(--accent3)'}
                          label={`📲 حملة قبل ${Math.floor((Date.now() - new Date(l.last_campaign_at).getTime()) / 86_400_000)} يوم${l.last_campaign_replied_at ? ' · ردّ' : ''}`}/>
                      )}
                      {l.in_hatif && <MiniPill color="var(--accent3)" label="📱 في فرص هاتف أيضاً"/>}
                    </div>
                  </td>
                  <td data-label="الموظف" style={{ padding: '10px 12px', minWidth: 150 }} onClick={e => e.stopPropagation()}>
                    {can('crm.assign') ? (
                      <Select value={l.owner_id || ''} onChange={e => assignLead(l, e.target.value)}>
                        <option value="">— بدون —</option>
                        {employees.map(e => <option key={e.id} value={e.id}>{e.name || e.email}</option>)}
                      </Select>
                    ) : (employees.find(e => e.id === l.owner_id)?.name || '—')}
                  </td>
                  <td data-label="الحالة" style={{ padding: '10px 12px' }}>
                    <LeadStatusBadge status={l.status}/>
                  </td>
                  <td style={{ padding: '10px 12px' }} onClick={e => e.stopPropagation()}>
                    <Btn size="sm" variant="ghost" onClick={() => setSel(l)}>إدارة</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)' }}>
            <Btn size="sm" variant="ghost" disabled={filters.page <= 0} onClick={() => setFilter({ page: Math.max(0, filters.page - 1) })}>السابق</Btn>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>صفحة {filters.page + 1} من {totalPages}</span>
            <Btn size="sm" variant="ghost" disabled={filters.page + 1 >= totalPages} onClick={() => setFilter({ page: filters.page + 1 })}>التالي</Btn>
          </div>
        </Card>
      )}
      {modal === 'upload' && <LeadUploadModal employees={employees} userId={user?.id} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }}/>}
      {modal === 'new' && <NewLeadModal onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} userId={user?.id}/>}
      {modal === 'hudhud' && <HudhudDiscoveryModal onClose={() => setModal(null)} onPromoted={refresh}/>}
      {waRecipients && (
        <WhatsAppSendModal open recipients={waRecipients}
          bucketLabel="جهات محتملة — عملاء خارج المنصّة"
          onClose={() => setWaRecipients(null)} onSent={() => setWaRecipients(null)}/>
      )}
      {sel && <LeadDrawer lead={sel} employees={employees} onClose={() => setSel(null)} onChanged={refresh}/>}
    </Pad>
  );
}

function HudhudDiscoveryModal({onClose,onPromoted}){
  const [cities,setCities]=useState([]),[city,setCity]=useState('riyadh'),[category,setCategory]=useState('shopping');
  const [rows,setRows]=useState([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const refresh=useCallback(async()=>{try{setRows(await loadHudhudCandidates({limit:100}));}catch(e){toast(`تعذر تحميل فرص هدهد: ${e.message}`,'error');}},[]);
  useEffect(()=>{Promise.all([loadHudhudCoverage(),loadHudhudCandidates({limit:100})]).then(([coverage,candidates])=>{setCities(coverage);setRows(candidates);}).catch(e=>toast(`تعذر فتح اكتشاف هدهد: ${e.message}`,'error'));},[]);
  const scan=async()=>{setBusy(true);setMessage('');try{const r=await runHudhudLeadScan(city,category);setMessage(`اكتمل فحص ${r.city}: عُثر على ${r.places_found}، أُثري ${r.places_enriched}، وحُفظ ${r.candidates_saved} مرشحًا.`);await refresh();}catch(e){toast(`فشل فحص هدهد: ${e.message}`,'error');}finally{setBusy(false);}};
  const approve=async row=>{setBusy(true);try{await approveHudhudCandidate(row.id,'اعتماد بشري من شاشة اكتشاف هدهد');toast(`أضيف ${row.name_ar} إلى CRM`,'success');await refresh();onPromoted?.();}catch(e){toast(`تعذر الاعتماد: ${e.message}`,'error');}finally{setBusy(false);}};
  const reject=async row=>{setBusy(true);try{await rejectHudhudCandidate(row.id,'غير مناسب بعد المراجعة');await refresh();}catch(e){toast(`تعذر الاستبعاد: ${e.message}`,'error');}finally{setBusy(false);}};
  return <Modal title="اكتشاف متاجر المملكة عبر هدهد" onClose={onClose} width={1050}>
    <div style={{padding:'11px 13px',borderRadius:10,background:'color-mix(in srgb, var(--accent3) 8%, var(--surface))',fontSize:12.5,lineHeight:1.8,marginBottom:14}}>نبحث عن المحلات والأنشطة الواعدة، ولا نشترط وجود رابط متجر في هدهد. الهاتف والحسابات الاجتماعية والتقييمات والنشاط المرئي ترفع قوة الفرصة. لا تُرسل أي رسالة تلقائيًا.</div>
    <div style={{display:'grid',gridTemplateColumns:'minmax(170px,1fr) minmax(170px,1fr) auto',gap:8,alignItems:'end',marginBottom:12}}>
      <label><span style={{display:'block',fontSize:11,fontWeight:800,marginBottom:5}}>المدينة</span><Select value={city} onChange={e=>setCity(e.target.value)}>{cities.map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</Select></label>
      <label><span style={{display:'block',fontSize:11,fontWeight:800,marginBottom:5}}>النشاط</span><Select value={category} onChange={e=>setCategory(e.target.value)}>{HUDHUD_LEAD_CATEGORIES.map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</Select></label>
      <Btn variant="primary" disabled={busy||!city} onClick={scan}>{busy?'جاري الفحص…':'فحص النطاق'}</Btn>
    </div>
    {message&&<div style={{padding:10,borderRadius:9,background:'color-mix(in srgb, var(--green) 9%, var(--surface))',color:'var(--green)',fontSize:12.5,marginBottom:12}}>{message}</div>}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}><strong>بانتظار المراجعة</strong><span style={{fontSize:11,color:'var(--muted)'}}>{rows.length} نتيجة مرتبة حسب قوة التأهيل</span></div>
    <div style={{maxHeight:'52vh',overflow:'auto',border:'1px solid var(--border)',borderRadius:10}}>
      <table className="m-cards" style={{width:'100%',borderCollapse:'collapse',fontSize:12.5}}><thead><tr style={{background:'var(--surface2)',textAlign:'right'}}>{['النشاط','الموقع','الإثبات','التقييم','الإجراء'].map(h=><th key={h} style={{padding:'9px 10px'}}>{h}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.id} style={{borderTop:'1px solid var(--border)'}}>
        <td data-label="النشاط" style={{padding:10}}><strong>{row.name_ar}</strong><div style={{color:'var(--muted)',fontSize:10.5,marginTop:3}}>{row.category_ar||'—'}</div></td>
        <td data-label="الموقع" style={{padding:10}}>{[row.district_ar,row.city_ar].filter(Boolean).join('، ')||'—'}</td>
        <td data-label="الإثبات" style={{padding:10}}><div>{row.website_url?'موقع ✓':'بلا موقع'}</div><div>{row.phone_normalized?'هاتف ✓':'بلا هاتف'}{row.instagram_url?' · إنستغرام ✓':''}</div></td>
        <td data-label="قوة الفرصة" style={{padding:10}}><strong style={{color:'var(--green)'}}>{row.ecommerce_score}/100</strong><div style={{fontSize:10.5,color:'var(--muted)'}}>{row.qualification_evidence?.classification==='digital_store_possible'?'نشاط رقمي محتمل':row.qualification_evidence?.classification==='social_seller_possible'?'بيع اجتماعي محتمل':'محل واعد'} · هدهد {row.rating?Number(row.rating).toFixed(1):'—'}</div></td>
        <td data-label="الإجراء" style={{padding:10}}><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{row.website_url&&<Btn size="sm" variant="ghost" onClick={()=>window.open(row.website_url,'_blank')}>فحص الموقع</Btn>}<Btn size="sm" variant="accent" disabled={busy} onClick={()=>approve(row)}>إضافة إلى CRM</Btn><Btn size="sm" variant="ghost" disabled={busy} onClick={()=>reject(row)}>استبعاد</Btn></div></td>
      </tr>)}</tbody></table>
      {!rows.length&&<div style={{padding:30,textAlign:'center',color:'var(--muted)'}}>لا توجد نتائج معلقة. شغّل أول نطاق للبدء.</div>}
    </div>
  </Modal>;
}

const LEAD_STATUS_OPTIONS = [
  { id: 'new', label: 'جديد' },
  { id: 'attempting', label: 'جارٍ التواصل' },
  { id: 'contacted', label: 'تم الرد' },
  { id: 'qualified', label: 'مؤهّل' },
  { id: 'proposal', label: 'عرض مقدّم' },
  { id: 'negotiation', label: 'تفاوض' },
  { id: 'nurture', label: 'متابعة لاحقة' },
  { id: 'existing_customer', label: 'عميل لدينا' },
  { id: 'converted', label: 'أُغلقت رابحة' },
  { id: 'activated', label: 'مفعّل فعلياً' },
  { id: 'lost', label: 'أُغلقت خاسرة' },
];

const LEAD_DISPOSITIONS = [
  { id: 'answered', label: 'ردّ العميل' },
  { id: 'interested', label: 'مهتم' },
  { id: 'callback', label: 'طلب اتصالاً لاحقاً' },
  { id: 'no_answer', label: 'لم يرد' },
  { id: 'busy', label: 'مشغول' },
];

const LOSS_REASONS = [
  { id: 'price', label: 'السعر' },
  { id: 'competitor', label: 'اختار منافساً' },
  { id: 'no_need', label: 'لا يحتاج الخدمة الآن' },
  { id: 'no_budget', label: 'لا توجد ميزانية' },
  { id: 'no_response', label: 'تعذر الوصول بعد المحاولات' },
  { id: 'out_of_scope', label: 'خارج نطاق الخدمة' },
  { id: 'duplicate', label: 'فرصة مكررة' },
  { id: 'wrong_number', label: 'رقم غير صحيح' },
];

function leadStatusLabel(status) {
  return LEAD_STATUS_OPTIONS.find(s => s.id === status)?.label || status || '—';
}

function LeadStatusBadge({ status }) {
  const color = ['converted','activated'].includes(status) ? 'var(--green)'
    : status === 'existing_customer' ? 'var(--accent)'
    : status === 'lost' ? 'var(--red)'
    : status === 'qualified' ? 'var(--brand)'
    : 'var(--gold)';
  return <span style={{ background: `color-mix(in srgb, ${color} 9%, transparent)`, color, padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 800 }}>{leadStatusLabel(status)}</span>;
}

function MiniPill({ color, label, icon = null }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, width: 'fit-content', background: `color-mix(in srgb, ${color} 8%, transparent)`, color, border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`, padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 800 }}>{icon}{label}</span>;
}

function CrmKpi({ label, value, color }) {
  return <Card style={{ padding: '12px 14px', borderTop: `3px solid ${color}` }}>
    <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 900, color, fontFamily: 'var(--font-mono)', marginTop: 4 }}>{value}</div>
  </Card>;
}

// مُعيّن الأعمدة الذكي — حقول قياسية موحّدة تُربَط بأي عمود من الملف (يلغي الحاجة
// لتوسيع HEADER_KEYS مع كل صيغة). الربط يُحفَظ محلياً لكل توقيع ترويسة فيُتذكَّر.
const LEAD_MAP_FIELDS = [
  { key: 'name',     label: 'اسم المتجر',   required: true },
  { key: 'phone',    label: 'رقم الجوال',   required: true },
  { key: 'whatsapp', label: 'واتساب' },
  { key: 'platform', label: 'المنصّة' },
  { key: 'category', label: 'المجال / القسم' },
  { key: 'city',     label: 'المدينة' },
  { key: 'email',    label: 'الإيميل' },
  { key: 'website',  label: 'الموقع / الرابط' },
];
const mapSignature = (headers) => 'sa-leadmap-v1:' + headers.map(h => h.label).join('|').slice(0, 400);
const loadSavedMap = (sig) => { try { return JSON.parse(localStorage.getItem(sig) || 'null'); } catch { return null; } };

function LeadUploadModal({ employees, userId, onClose, onSaved }) {
  const [fileName, setFileName] = useState('');
  const [raw, setRaw] = useState(null);            // صفوف الملف الخام
  const [detect, setDetect] = useState(null);      // { headers, cols }
  const [mapping, setMapping] = useState({});      // {field: columnIndex | -1}
  const [parsed, setParsed] = useState(null);
  const [assignMode, setAssignMode] = useState('me');
  const [ownerId, setOwnerId] = useState(userId || '');
  const [leadKind, setLeadKind] = useState('inbound');
  const [campaignName, setCampaignName] = useState('');
  const [busy, setBusy] = useState(false);

  const onFile = async (file) => {
    setBusy(true); setParsed(null); setDetect(null); setRaw(null);
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
      const d = detectLeadColumns(rows);
      // القيمة الأولية لكل حقل: المحفوظ لهذه الترويسة، وإلا الربط التلقائي (الهاتف
      // من phone ثم phoneAlt ثم unified).
      const saved = loadSavedMap(mapSignature(d.headers));
      const autoPhone = d.cols.phone >= 0 ? d.cols.phone : d.cols.phoneAlt >= 0 ? d.cols.phoneAlt : (d.cols.unifiedPhone ?? -1);
      const init = {};
      for (const f of LEAD_MAP_FIELDS) {
        const auto = f.key === 'phone' ? autoPhone : (d.cols[f.key] ?? -1);
        init[f.key] = saved && saved[f.key] != null ? saved[f.key] : (auto >= 0 ? auto : -1);
      }
      setRaw(rows); setDetect(d); setMapping(init); setFileName(file.name);
    } catch (e) { toast(`فشل قراءة الملف: ${e.message}`, 'error'); }
    setBusy(false);
  };

  // متابعة من مُعيّن الأعمدة → تحليل بالربط المختار + حفظه لهذه الترويسة
  const applyMapping = () => {
    if (mapping.name == null || mapping.name < 0) { toast('عيّن عمود «اسم المتجر»', 'warn'); return; }
    if (mapping.phone == null || mapping.phone < 0) { toast('عيّن عمود «رقم الجوال»', 'warn'); return; }
    try {
      const override = {};
      for (const f of LEAD_MAP_FIELDS) override[f.key] = mapping[f.key] >= 0 ? mapping[f.key] : -1;
      // الهاتف يذهب لحقل phone؛ نُعطّل البدائل كي لا يُلتقَط عمود آخر
      override.phoneAlt = -1; override.unifiedPhone = -1;
      const p = parseLeadsRows(raw, override);
      setParsed(p);
      try { localStorage.setItem(mapSignature(detect.headers), JSON.stringify(mapping)); } catch { /* */ }
    } catch (e) { toast(e.message, 'error'); }
  };

  const save = async () => {
    if (!parsed?.rows?.length) return;
    setBusy(true);
    try {
      const assigneeIds = assignMode === 'round_robin' ? employees.map(e => e.id).filter(Boolean) : [];
      const targetOwner = assignMode === 'none' ? null : (assignMode === 'specific' ? ownerId : userId);
      const res = await uploadLeadsSnapshot({
        rows: parsed,
        userId,
        ownerId: targetOwner,
        assigneeIds,
        leadKind,
        sourceChannel: 'excel',
        campaignName,
      });
      toast(`أضيف ${res.added} جهة محتملة · تخطي ${res.skipped}${res.skippedExisting ? ` (منهم ${res.skippedExisting} عميل لدينا مستبعَد)` : ''}`, 'success');
      onSaved();
    } catch (e) { toast(`فشل الحفظ: ${e.message}`, 'error'); }
    setBusy(false);
  };

  const s = parsed?.stats;
  return (
    <Modal title="رفع وتنظيف متاجر خارجية" onClose={onClose} width={680}>
      <div className="m-flow" style={{ maxHeight: '72vh', overflowY: 'auto', paddingInlineEnd: 4 }}>
        <DropZone onFile={onFile} title={fileName || 'اختر ملف Excel'} hint="أي ملف متاجر — ستربط أعمدته (اسم/رقم/منصّة/مجال…) بضغطة. يتعرّف تلقائياً على سلة/زد/معروف."/>
        {busy && <div style={{ padding: 16, textAlign: 'center' }}><Spinner/></div>}

        {/* مُعيّن الأعمدة — يظهر بعد قراءة الملف وقبل التحليل */}
        {detect && !parsed && (
          <Card style={{ padding: 14, marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>ربط أعمدة الملف بالحقول القياسية</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 12 }}>
              تعرّفنا تلقائياً على {Object.values(mapping).filter(v => v >= 0).length} حقل. عدّل أي ربط غير صحيح — يُحفَظ لهذه الصيغة فلا تعيده.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
              {LEAD_MAP_FIELDS.map(f => (
                <div key={f.key}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>
                    {f.label} {f.required && <span style={{ color: 'var(--red)' }}>*</span>}
                  </div>
                  <Select value={mapping[f.key] ?? -1} onChange={e => setMapping(m => ({ ...m, [f.key]: Number(e.target.value) }))}
                    style={{ borderColor: f.required && (mapping[f.key] == null || mapping[f.key] < 0) ? 'var(--red)' : undefined }}>
                    <option value={-1}>— لا شيء —</option>
                    {detect.headers.map(h => <option key={h.idx} value={h.idx}>{h.label}</option>)}
                  </Select>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <Btn variant="accent" onClick={applyMapping}>متابعة ←</Btn>
            </div>
          </Card>
        )}

        {s && (
          <>
            <Btn size="sm" variant="ghost" onClick={() => setParsed(null)} style={{ marginTop: 12 }}>← تعديل ربط الأعمدة</Btn>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 14 }}>
              <CrmKpi label="صفوف مقروءة" value={fmt0(s.totalRows)} color="var(--accent3)"/>
              <CrmKpi label="بأرقام صالحة" value={fmt0(s.withPhone)} color="var(--green)"/>
              <CrmKpi label="أرقام غير صالحة" value={fmt0(s.invalidPhone)} color="var(--red)"/>
              <CrmKpi label="أرقام مكررة" value={fmt0(s.duplicateRows)} color="var(--gold)"/>
            </div>
            {s.duplicateRows > 0 && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: 'color-mix(in srgb, var(--gold) 10%, transparent)', color: 'var(--gold)', fontSize: 12 }}>
                يوجد {fmt0(s.duplicatePhones)} رقم مستخدم في أكثر من متجر. لن نحذفها، سنحفظها مع وسم “نفس الرقم” لتراجعها المبيعات.
              </div>
            )}
            <Card style={{ padding: 12, marginTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>نوع الملف ومصدر الفرص</div>
              <Select value={leadKind} onChange={e => setLeadKind(e.target.value)}>
                <option value="inbound">مهتمون من حملة — يدخلون SLA ويظهرون في «يومي»</option>
                <option value="cold">قائمة استهداف باردة — لا تبدأ مهلة اتصال تلقائياً</option>
              </Select>
              {leadKind === 'inbound' && (
                <Input style={{ marginTop: 8 }} label="اسم الحملة"
                  placeholder="مثال: حملة أغسطس — Meta"
                  value={campaignName} onChange={e => setCampaignName(e.target.value)}/>
              )}
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8 }}>
                المهتم من الحملة يحصل على مهلة أول تواصل 15 دقيقة. اختر «قائمة باردة» للدلائل وقوائم الاستهداف فقط.
              </div>
            </Card>
            <Card style={{ padding: 12, marginTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>إسناد العملاء المحتملين بعد الرفع</div>
              <Select value={assignMode} onChange={e => setAssignMode(e.target.value)}>
                <option value="me">إسناد لي</option>
                <option value="specific">إسناد لموظف محدد</option>
                <option value="round_robin">توزيع بالتساوي على كل الموظفين</option>
                <option value="none">بدون إسناد</option>
              </Select>
              {assignMode === 'specific' && (
                <Select style={{ marginTop: 8 }} value={ownerId} onChange={e => setOwnerId(e.target.value)}>
                  <option value="">— اختر موظف —</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name || e.email}</option>)}
                </Select>
              )}
            </Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 14 }}>
              <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
              <Btn variant="accent" disabled={busy || !parsed.rows.length || (assignMode === 'specific' && !ownerId)} onClick={save}>
                اعتماد التنظيف وحفظ {fmt0(parsed.rows.length)} جهة محتملة
              </Btn>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function LeadDrawer({ lead, employees, onClose, onChanged }) {
  const { user, can } = useAuth();
  const [timeline, setTimeline] = useState([]);
  const [form, setForm] = useState({ mode: null });
  const [busy, setBusy] = useState(false);
  const [siblings, setSiblings] = useState([]);   // متاجر أخرى على نفس الرقم (جلب حيّ)
  const reload = useCallback(async () => {
    try { setTimeline(await loadTimeline({ entityType: 'lead', entityRef: lead.id })); }
    catch (e) { toast(e.message, 'error'); }
  }, [lead.id]);
  useEffect(() => { reload(); }, [reload]);
  // جلب حيّ لكل الجهات على نفس الرقم — لا يعتمد على duplicate_names (تلتقط
  // تكرار داخل الملف فقط؛ التكرار عبر الرفعات يظهر هنا)
  useEffect(() => {
    if (Number(lead.duplicate_count) > 1) {
      loadLeadsByPhone(lead.phone_normalized || lead.phone, lead.id).then(setSiblings).catch(() => setSiblings([]));
    } else setSiblings([]);
  }, [lead.id, lead.duplicate_count, lead.phone_normalized, lead.phone]);

  const act = async (fn, ok, closeAfter = false) => {
    setBusy(true);
    try {
      await fn();
      toast(ok, 'success');
      setForm({ mode: null });
      onChanged?.();
      if (closeAfter) onClose();
      else await reload();
    }
    catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <Modal title={lead.name} onClose={onClose} width={680}>
      <div className="m-flow" style={{ maxHeight: '76vh', overflowY: 'auto', paddingInlineEnd: 4 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 12 }}>
          <Hd label="الجوال" value={<PhoneLink phone={lead.phone_normalized || lead.phone} name={lead.name}/>}/>
          <Hd label="القسم" value={lead.category || '—'}/>
          <Hd label="المنصة" value={lead.platform || '—'}/>
          <Hd label="الحالة" value={<LeadStatusBadge status={lead.status}/>}/>
          <Hd label="المصدر" value={lead.lead_kind === 'inbound' ? (lead.campaign_name || 'حملة واردة') : 'قائمة استهداف'}/>
          <Hd label="محاولات التواصل" value={fmt0(lead.contact_attempts || 0)}/>
          <Hd label="الإجراء التالي" value={lead.next_action_at ? new Date(lead.next_action_at).toLocaleString('ar-SA') : 'غير محدد'}
            color={lead.next_action_at && new Date(lead.next_action_at) < new Date() ? 'var(--red)' : undefined}/>
          {lead.duplicate_count > 1 && <Hd label="تكرار الرقم" value={`${lead.duplicate_count} متاجر`} color="var(--gold)"/>}
          <Hd label="آخر حملة واتساب" color={lead.last_campaign_at ? (lead.last_campaign_replied_at ? 'var(--green)' : 'var(--accent3)') : 'var(--muted2)'}
            value={lead.last_campaign_at
              ? `${fmtDate(lead.last_campaign_at)} · ${lead.last_campaign_template || ''}${lead.last_campaign_replied_at ? ' · ردّ ✓' : ''}`
              : 'لم تُرسَل له حملة'}/>
        </div>
        {/* المتاجر الأخرى بنفس الرقم — جلب حيّ (يظهر التكرار عبر الرفعات الذي لا
            تلتقطه duplicate_names). fallback للأسماء المخزَّنة إن لم يصل الجلب بعد */}
        {lead.duplicate_count > 1 && (siblings.length > 0 || (Array.isArray(lead.duplicate_names) && lead.duplicate_names.filter(n => n && n !== lead.name).length > 0)) && (
          <Card style={{ padding: 12, background: 'color-mix(in srgb, var(--gold) 7%, transparent)', borderColor: 'color-mix(in srgb, var(--gold) 30%, var(--border))', marginBottom: 12 }}>
            <div style={{ fontWeight: 800, color: 'var(--gold)', fontSize: 12.5, marginBottom: 8 }}>⚠️ {siblings.length || (lead.duplicate_count - 1)} متجر آخر بنفس هذا الرقم</div>
            {siblings.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {siblings.map(s => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 10px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <span style={{ fontWeight: 700, fontSize: 12.5 }}>{s.name}</span>
                    {s.category && <span style={{ fontSize: 11, color: 'var(--muted)' }}>· {s.category}</span>}
                    {s.city && <span style={{ fontSize: 11, color: 'var(--muted2)' }}>· {s.city}</span>}
                    {s.platform && <MiniPill color="var(--accent)" label={s.platform}/>}
                    <span style={{ marginInlineStart: 'auto', display: 'flex', gap: 6 }}>
                      {(s.store_url || s.website) && <button onClick={() => window.open(s.store_url || s.website, '_blank')} title="فتح المتجر" style={{ border: '1px solid var(--border)', background: 'var(--bg)', borderRadius: 6, cursor: 'pointer', padding: '2px 7px', fontSize: 11, color: 'var(--accent)' }}><ExternalLink size={11}/></button>}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {lead.duplicate_names.filter(n => n && n !== lead.name).map((n, i) => (
                  <span key={i} style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}>{n}</span>
                ))}
              </div>
            )}
          </Card>
        )}
        {(lead.website || lead.store_url || lead.social_links?.instagram) && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {lead.website && <Btn size="sm" variant="ghost" icon={<ExternalLink size={13}/>} onClick={() => window.open(lead.website, '_blank')}>الموقع</Btn>}
            {lead.store_url && <Btn size="sm" variant="ghost" icon={<ExternalLink size={13}/>} onClick={() => window.open(lead.store_url, '_blank')}>رابط المتجر</Btn>}
            {lead.social_links?.instagram && <Btn size="sm" variant="ghost" icon={<ExternalLink size={13}/>} onClick={() => window.open(lead.social_links.instagram, '_blank')}>إنستجرام</Btn>}
          </div>
        )}
        {lead.matched_store_id && (
          <Card style={{ padding: 12, background: 'color-mix(in srgb, var(--accent) 8%, transparent)', borderColor: 'color-mix(in srgb, var(--accent) 22%, transparent)', marginBottom: 12 }}>
            <div style={{ fontWeight: 900, color: 'var(--accent)', marginBottom: 6 }}>هذا الرقم موجود عندنا في المنصّة</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
              <Hd label="اسم المنصّة" value={lead.matched_store_name}/>
              <Hd label="الحالة" value={lead.matched_store_status || '—'}/>
              <Hd label="الدفع" value={lead.matched_store_billing_type || '—'}/>
              <Hd label="الشحنات" value={fmt0(lead.matched_store_shipments || 0)}/>
              <Hd label="آخر شحنة" value={fmtDate(lead.matched_store_last_shipment_at)}/>
              <Hd label="المحفظة" value={fmt(lead.matched_store_wallet || 0)}/>
            </div>
          </Card>
        )}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {can('crm.change_status') && !['converted','activated','lost','existing_customer'].includes(lead.status) &&
            <Btn size="sm" variant="primary" icon={<Phone size={13}/>}
              onClick={() => setForm({ mode: 'outcome', disposition: 'answered', status: lead.status === 'new' ? 'contacted' : lead.status, next: '', notes: '' })}>
              تسجيل نتيجة التواصل
            </Btn>}
          {can('crm.log_activity') && <Btn size="sm" variant="ghost" icon={<StickyNote size={13}/>} onClick={() => setForm({ mode: 'note', body: '' })}>ملاحظة</Btn>}
          {can('crm.manage_tasks') && <Btn size="sm" variant="ghost" icon={<CalendarClock size={13}/>} onClick={() => setForm({ mode: 'task', title: '', due: '' })}>جدولة</Btn>}
          {can('crm.assign') && <Btn size="sm" variant="ghost" icon={<UserCog size={13}/>} onClick={() => setForm({ mode: 'assign', ownerId: lead.owner_id || '' })}>إسناد</Btn>}
          {can('crm.convert_lead') && !['converted','activated','lost','existing_customer'].includes(lead.status) &&
            <Btn size="sm" variant="accent" onClick={() => setForm({ mode: 'won', notes: '' })}>إغلاق رابح</Btn>}
          {can('crm.change_status') && !['converted','activated','lost','existing_customer'].includes(lead.status) &&
            <Btn size="sm" variant="danger" onClick={() => setForm({ mode: 'lost', reason: '', notes: '' })}>إغلاق خاسر</Btn>}
          {/* §1.37: صفقة مربوطة بالجهة بنقرة — كانت الصفقات تُنشأ باسم حر منفصل */}
          {can('crm.manage_deals') && (
            <Btn size="sm" variant="accent" icon={<TrendingUp size={13}/>} disabled={busy}
              onClick={() => act(async () => {
                await createDeal({
                  title: `صفقة — ${lead.name}`, entityType: 'lead', entityRef: lead.id,
                  value: 0, ownerId: lead.owner_id || user?.id, userId: user?.id,
                });
              }, `أُنشئت صفقة مربوطة بـ${lead.name} — تابعها في «صفقات المبيعات»`)}>
              أنشئ صفقة
            </Btn>
          )}
        </div>

        {form.mode && (
          <Card style={{ padding: 12, background: 'var(--surface2)', marginBottom: 12 }}>
            {form.mode === 'outcome' && <>
              <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 10 }}>نتيجة التواصل والخطوة التالية</div>
              <Select label="ماذا حدث؟" value={form.disposition} onChange={e => setForm({ ...form, disposition: e.target.value })}>
                {LEAD_DISPOSITIONS.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
              </Select>
              <Select label="مرحلة الفرصة" style={{ marginTop: 8 }} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                {LEAD_STATUS_OPTIONS.filter(s => !['converted','activated','lost','existing_customer'].includes(s.id)).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
              <Input label="موعد الإجراء التالي" type="datetime-local" style={{ marginTop: 8 }}
                value={form.next} onChange={e => setForm({ ...form, next: e.target.value })}/>
              <Input label="ملخص التواصل" style={{ marginTop: 8 }} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}/>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                <Btn size="sm" variant="ghost" onClick={() => setForm({ mode: null })}>إلغاء</Btn>
                <Btn size="sm" variant="accent" disabled={busy || !form.next} onClick={() => act(async () => {
                  await recordLeadOutcome(lead.id, {
                    disposition: form.disposition,
                    status: form.status,
                    nextActionAt: new Date(form.next).toISOString(),
                    notes: form.notes,
                  });
                }, 'حُفظت النتيجة والموعد التالي', true)}>حفظ النتيجة</Btn>
              </div>
            </>}
            {form.mode === 'note' && <>
              <Input label="الملاحظة" value={form.body} onChange={e => setForm({ ...form, body: e.target.value })}/>
              <Btn size="sm" variant="accent" disabled={busy || !form.body} onClick={() => act(() => logActivity({ entityType: 'lead', entityRef: lead.id, kind: 'note', summary: form.body, body: form.body, userId: user?.id }), 'تم حفظ الملاحظة')}>حفظ</Btn>
            </>}
            {form.mode === 'task' && <>
              <Input label="عنوان الموعد" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}/>
              <Input label="تاريخ/وقت الموعد" type="datetime-local" value={form.due} onChange={e => setForm({ ...form, due: e.target.value })}/>
              <Btn size="sm" variant="accent" disabled={busy || !form.title || !form.due} onClick={() => act(() => createTask({ entityType: 'lead', entityRef: lead.id, title: form.title, dueAt: new Date(form.due).toISOString(), assignedTo: lead.owner_id || user?.id, userId: user?.id }), 'تمت الجدولة')}>جدولة</Btn>
            </>}
            {form.mode === 'assign' && <>
              <Select label="الموظف" value={form.ownerId} onChange={e => setForm({ ...form, ownerId: e.target.value })}>
                <option value="">— بدون —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name || e.email}</option>)}
              </Select>
              <Btn size="sm" variant="accent" disabled={busy} onClick={() => act(() => assignOwner({ entityType: 'lead', entityRef: lead.id, ownerId: form.ownerId || null, ownerName: employees.find(e => e.id === form.ownerId)?.name, userId: user?.id }), 'تم الإسناد')}>حفظ</Btn>
            </>}
            {form.mode === 'won' && <>
              <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--green)', marginBottom: 8 }}>تأكيد إغلاق البيع</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                هذا يعني أن البيع أُغلق. تفعيل المتجر وأول شحنة يبقيان مرحلة مستقلة قابلة للقياس.
              </div>
              <Input label="ملاحظة الإغلاق" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}/>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                <Btn size="sm" variant="ghost" onClick={() => setForm({ mode: null })}>إلغاء</Btn>
                <Btn size="sm" variant="accent" disabled={busy} onClick={() => act(() => closeLead(lead.id, {
                  won: true,
                  notes: form.notes,
                  customerName: lead.matched_store_name || lead.name,
                  storeId: lead.matched_store_id,
                }), 'أُغلقت الفرصة رابحة', true)}>تأكيد البيع</Btn>
              </div>
            </>}
            {form.mode === 'lost' && <>
              <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--red)', marginBottom: 8 }}>إغلاق الفرصة خاسرة</div>
              <Select label="سبب الخسارة" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}>
                <option value="">— اختر السبب —</option>
                {LOSS_REASONS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </Select>
              <Input label="تفاصيل تساعد الفريق" style={{ marginTop: 8 }} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}/>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                <Btn size="sm" variant="ghost" onClick={() => setForm({ mode: null })}>إلغاء</Btn>
                <Btn size="sm" variant="danger" disabled={busy || !form.reason}
                  onClick={() => act(() => closeLead(lead.id, { won: false, reason: form.reason, notes: form.notes }), 'أُغلقت الفرصة مع حفظ السبب', true)}>
                  إغلاق خاسر
                </Btn>
              </div>
            </>}
          </Card>
        )}

        <div style={{ fontSize: 13, fontWeight: 900, margin: '12px 0 8px' }}>سجل التواصل</div>
        {!timeline.length ? <Empty icon="🗒️" title="لا يوجد تواصل بعد" sub="سجّل أول مكالمة أو ملاحظة"/> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {timeline.map(t => (
              <div key={t.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <b>{t.summary || t.kind}</b>
                  <span style={{ color: 'var(--muted)', fontSize: 11 }}>{fmtDate(t.occurred_at)}</span>
                </div>
                {t.body && <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>{t.body}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function NewLeadModal({ onClose, onSaved, userId }) {
  const [f, setF] = useState({ name: '', phone: '', city: '', campaignName: '', notes: '' });
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="جهة جديدة" onClose={onClose} width={440}>
      <Input label="اسم المتجر/الجهة" value={f.name} onChange={e => setF({ ...f, name: e.target.value })}/>
      <Input label="الجوال" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })}/>
      <Input label="المدينة" value={f.city} onChange={e => setF({ ...f, city: e.target.value })}/>
      <Input label="مصدر/اسم الحملة" value={f.campaignName} onChange={e => setF({ ...f, campaignName: e.target.value })}/>
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
      <PageHeader icon={<TrendingUp size={22}/>} title="صفقات المبيعات" subtitle="مسار الصفقات — انقل الصفقة عبر قائمة المرحلة داخل البطاقة"
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
                    {can('crm.manage_deals') && <Select style={{ marginTop: 4 }} value={d.stage_id} onChange={async e => {
                      const target = stages.find(s => s.id === e.target.value);
                      try {
                        if (target?.is_lost) {
                          const reason = window.prompt('سبب خسارة الصفقة (مطلوب):');
                          if (!reason?.trim()) return;
                          await closeDeal(d.id, { won: false, lostReason: reason.trim(), userId: user?.id });
                        } else if (target?.is_won) {
                          if (!window.confirm('تأكيد إغلاق الصفقة رابحة؟')) return;
                          await closeDeal(d.id, { won: true, userId: user?.id });
                        } else {
                          await moveDeal(d.id, e.target.value, { userId: user?.id });
                        }
                        refresh();
                      } catch (err) { toast(err.message, 'error'); }
                    }}>
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
  const [commitments, setCommitments] = useState([]);
  const [commitmentFilter, setCommitmentFilter] = useState('work');
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [taskRows, commitmentRows] = await Promise.all([
        loadTasks({ assignee: can('crm.view_all') ? null : user?.id, openOnly: true }),
        (can('crm.view_all') || can('whatsapp.view_log'))
          ? loadHatifCallCommitments().catch(() => []) : Promise.resolve([]),
      ]);
      setTasks(taskRows);
      setCommitments(commitmentRows);
    }
    catch (e) { toast(e.message, 'error'); }
    setLoading(false);
  }, [user?.id, can]);
  useEffect(() => { if (active) refresh(); }, [active, refresh]);

  if (!can('crm.view')) return <Pad><Empty icon="🔒" title="لا صلاحية"/></Pad>;
  const now = Date.now();
  const summary = summarizeHatifCommitments(commitments, now);
  const filteredCommitments = commitments.filter(row => {
    if (commitmentFilter === 'all') return true;
    if (commitmentFilter === 'done') return ['on_time_answered', 'on_time_no_answer'].includes(row.status);
    if (commitmentFilter === 'breach') return ['late_answered', 'late_no_answer', 'missed'].includes(row.status);
    if (commitmentFilter === 'review') return row.status === 'needs_confirmation';
    return row.status === 'pending';
  }).sort((a, b) => {
    const aTime = new Date(a.window_start || a.source_call_at).getTime();
    const bTime = new Date(b.window_start || b.source_call_at).getTime();
    return commitmentFilter === 'work' ? aTime - bTime : bTime - aTime;
  });
  return (
    <Pad>
      <PageHeader icon={<CalendarClock size={22}/>} title="المواعيد والالتزامات" subtitle="المواعيد الداخلية + وعود الاتصال المطابقة تلقائياً مع سجل هاتف"
        actions={<Btn size="sm" variant="ghost" title="تحديث المواعيد" ariaLabel="تحديث المواعيد" onClick={refresh}><RefreshCw size={14}/></Btn>}/>

      {(can('crm.view_all') || can('whatsapp.view_log')) && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
            <CrmKpi label="مواعيد قادمة" value={summary.upcoming} color="var(--blue)"/>
            <CrmKpi label="مستحقة اليوم" value={summary.dueToday} color="var(--accent3)"/>
            <CrmKpi label="تمت في الموعد" value={summary.onTime} color="var(--green)"/>
            <CrmKpi label="حاول في الموعد بلا رد" value={summary.attemptedNoAnswer} color="var(--accent3)"/>
            <CrmKpi label="متأخرة أو فائتة" value={summary.breached} color="var(--red)"/>
          </div>
          <Card style={{ padding: 14, marginBottom: 16, borderTop: '3px solid var(--blue)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 14 }}>التزام الاتصال من هاتف</div>
                <div style={{ color: 'var(--muted)', fontSize: 11.5, marginTop: 2 }}>لا يعتمد على ضغط زر؛ يطابق المكالمة الصادرة واسم الموظف ووقت الرد الفعلي.</div>
              </div>
              <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {[['work','القادمة'],['done','في الموعد'],['breach','المتأخرة/الفائتة'],['review',`تحتاج تأكيد (${summary.review})`],['all','الكل']].map(([id, label]) => (
                  <Btn key={id} size="sm" variant={commitmentFilter === id ? 'primary' : 'outline'} onClick={() => setCommitmentFilter(id)}>{label}</Btn>
                ))}
              </div>
            </div>
            {!filteredCommitments.length ? (
              <Empty icon="📞" title="لا التزامات في هذا العرض" sub="الوعد الواضح في ملخص مكالمة هاتف يُلتقط آلياً، والغامض ينتظر تأكيداً بدلاً من إنشاء موعد خاطئ."/>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {filteredCommitments.map(row => {
                  const meta = hatifCommitmentMeta(row, now);
                  const mismatch = row.owner_match === false && row.actual_agent_name;
                  return (
                    <div key={row.id} style={{ border: '1px solid var(--border)', borderInlineStart: `4px solid ${meta.color}`, borderRadius: 10, padding: '10px 12px', background: 'var(--surface2)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <b style={{ fontSize: 13 }}>{row.phone}</b>
                        <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 800, color: meta.color, background: `color-mix(in srgb, ${meta.color} 10%, transparent)` }}>{meta.label}</span>
                        {mismatch && <span style={{ color: 'var(--gold)', fontSize: 11, fontWeight: 800 }}>نفذها {row.actual_agent_name} بدل {row.expected_agent_name || 'الموظف المتوقع'}</span>}
                        <a href={`tel:+${row.phone}`} style={{ marginInlineStart: 'auto', color: 'var(--accent)', fontSize: 11.5, fontWeight: 800, textDecoration: 'none' }}>اتصال</a>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 8, marginTop: 8, fontSize: 11.5 }}>
                        <Hd label="نافذة الاتصال" value={row.window_start ? `${saDateTime(row.window_start)} – ${saTime(row.window_end)}` : 'غير واضحة — تحتاج تأكيد'}/>
                        <Hd label="الموظف المتوقع" value={row.expected_agent_name || 'غير محدد'}/>
                        <Hd label="المنفذ فعلياً" value={row.actual_agent_name || 'لم تُطابق مكالمة بعد'} color={mismatch ? 'var(--gold)' : undefined}/>
                        <Hd label="وقت المحاولة" value={row.attempted_at ? saDateTime(row.attempted_at) : '—'}/>
                      </div>
                      <details style={{ marginTop: 7, fontSize: 11.5, color: 'var(--muted)' }}>
                        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>مصدر الالتزام من ملخص المكالمة</summary>
                        <div style={{ marginTop: 5, lineHeight: 1.7 }}>{row.source_text}</div>
                      </details>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}

      <div style={{ fontWeight: 900, fontSize: 14, margin: '4px 0 10px' }}>المواعيد الداخلية المفتوحة</div>
      {loading && !tasks.length ? <Spin/> : !tasks.length ? <Empty icon="⏰" title="لا مواعيد داخلية" sub="لا مهام مجدوَلة"/> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tasks.map(t => {
            const overdue = new Date(t.due_at).getTime() < now;
            return (
              <Card key={t.id} style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, borderRight: `3px solid ${overdue ? 'var(--red)' : 'var(--accent3)'}` }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{t.title}</div>
                  <div style={{ fontSize: 11.5, color: overdue ? 'var(--red)' : 'var(--muted)' }}>{t.entity_ref} · {saDateTime(t.due_at)} {overdue ? '· متأخّر' : ''}</div>
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
  const { can, user, isAdmin } = useAuth();
  const [s, setS] = useState(null);
  const [employees, setEmployees] = useState([]);
  // §1.37: معدل التحويل بالموظف (RPC sales_owner_stats) + أهداف أسبوعية
  const [ownerStats, setOwnerStats] = useState([]);
  const [targets, setTargets] = useState({ touches7d: 0, conversions: 0 });
  const [targetEdit, setTargetEdit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [stats, emp] = await Promise.all([loadBoardStats(), loadEmployees().catch(() => [])]);
      setS(stats);
      setEmployees(emp);
      import('../lib/retargetingService.js').then(m => m.loadSalesOwnerStats().then(setOwnerStats).catch(() => {}));
      import('../lib/supabase.js').then(({ supabase }) =>
        supabase.from('app_settings').select('value').eq('key', 'sales_targets').maybeSingle()
          .then(({ data }) => { if (data?.value) setTargets({ touches7d: Number(data.value.touches7d) || 0, conversions: Number(data.value.conversions) || 0 }); }));
    } catch (e) {
      setError(e.message || 'تعذّر تحميل مؤشرات الأداء');
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, []);
  const saveTargets = async () => {
    try {
      const { supabase } = await import('../lib/supabase.js');
      const { error } = await supabase.from('app_settings').upsert({ key: 'sales_targets', value: targets }, { onConflict: 'key' });
      if (error) throw error;
      toast('حُفظت الأهداف ✓', 'success'); setTargetEdit(false);
    } catch (e) { toast(`فشل الحفظ: ${e.message}`, 'error'); }
  };
  useEffect(() => { if (active) refresh(); }, [active, refresh]);
  if (!can('crm.view')) return <Pad><Empty icon="🔒" title="لا صلاحية"/></Pad>;
  if (!s && loading) return <Pad><Card style={{ padding: 32, textAlign: 'center' }}><Spinner size={24}/><div style={{ marginTop: 10, color: 'var(--muted)', fontSize: 12 }}>نجمّع مؤشرات الفريق داخل القاعدة…</div></Card></Pad>;
  if (!s && error) return <Pad><Card style={{ padding: 28, textAlign: 'center' }}><AlertTriangle size={25} color="var(--red)"/><div style={{ margin: '9px 0 14px' }}>{error}</div><Btn variant="primary" onClick={refresh}>إعادة المحاولة</Btn></Card></Pad>;
  if (!s) return <Pad><Spin/></Pad>;
  const convByOwner = new Map(ownerStats.map(o => [o.ownerId, o]));
  const myConv = convByOwner.get(user?.id);
  const cards = [
    { l: 'مرّات التواصل هذا الأسبوع', v: s.touchesThisWeek, c: 'var(--accent3)' },
    { l: 'جهات محتملة مفتوحة', v: s.leadsOpen, c: 'var(--green)' },
    { l: 'أرقام مكررة', v: s.leadsDuplicateRows, c: 'var(--gold)' },
    { l: 'عملاء لدينا داخل القائمة', v: s.leadsExistingCustomers, c: 'var(--accent)' },
    { l: 'وعود نشطة', v: s.promisesOpen, c: 'var(--gold)' },
    { l: 'وعود محقّقة', v: s.promisesKept, c: 'var(--green)' },
    { l: 'وعود لم تُوفَ', v: s.promisesBroken, c: 'var(--red)' },
    { l: 'صفقات مفتوحة', v: s.dealsOpenCount, c: 'var(--accent)' },
    { l: 'قيمة الصفقات المفتوحة', v: `${fmt0(s.pipelineValue)} ر.س`, c: 'var(--brand)' },
  ];
  const employeeName = (id) => id
    ? (employees.find(e => e.id === id)?.name || employees.find(e => e.id === id)?.email || 'موظف')
    : 'بدون إسناد';
  return (
    <Pad>
      <PageHeader icon={<BarChart3 size={22}/>} title="أداء المبيعات والمتابعة"
        subtitle="من عنده جهات؟ من تواصل؟ ومعدل تحويل كل موظف مقابل الهدف"
        actions={<Btn size="sm" variant="ghost" title="تحديث مؤشرات الأداء" disabled={loading} onClick={refresh}><RefreshCw size={14} className={loading ? 'spin' : ''}/></Btn>}/>

      {/* «أرقامي» — بطاقة الموظف الشخصية (§1.37) */}
      {myConv && (
        <Card style={{ padding: '12px 16px', marginBottom: 14, border: '1.5px solid color-mix(in srgb, var(--gold) 35%, var(--border))', display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 900 }}>🎯 أرقامي</span>
          <MyStat label="فرصي المسندة" v={fmt0(myConv.assigned)} c="var(--accent3)"/>
          <MyStat label="عملت عليها" v={fmt0(myConv.worked)} c="var(--gold)"/>
          <MyStat label="عادوا/تحوّلوا" v={fmt0(myConv.returned)} c="var(--green)"/>
          <MyStat label="معدل تحويلي" v={`${myConv.conversionPct}%`} c="var(--accent)"/>
          <MyStat label={`تواصلي (7 أيام)${targets.touches7d ? ` / هدف ${targets.touches7d}` : ''}`}
            v={fmt0(myConv.touches7d)}
            c={targets.touches7d ? (myConv.touches7d >= targets.touches7d ? 'var(--green)' : 'var(--red)') : 'var(--accent3)'}/>
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
        {cards.map(c => (
          <Card key={c.l} style={{ borderTop: `3px solid ${c.c}` }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.l}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: c.c, fontFamily: 'var(--font-mono)', marginTop: 4 }}>{c.v}</div>
          </Card>
        ))}
      </div>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 900 }}>أداء الموظفين</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>الجهات المسندة، التواصل، معدل التحويل من متابعات إعادة الاستهداف، والصفقات</div>
          </div>
          {isAdmin && (
            <span style={{ marginInlineStart: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
              {targetEdit ? (
                <>
                  هدف التواصل/أسبوع:
                  <input type="number" value={targets.touches7d} onChange={e => setTargets(t => ({ ...t, touches7d: Number(e.target.value) || 0 }))}
                    style={{ width: 70, padding: '4px 8px', borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text)' }}/>
                  <Btn size="sm" variant="accent" onClick={saveTargets}>حفظ</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setTargetEdit(false)}>إلغاء</Btn>
                </>
              ) : (
                <Btn size="sm" variant="ghost" onClick={() => setTargetEdit(true)}>
                  🎯 الهدف الأسبوعي: {targets.touches7d || 'غير محدد'}
                </Btn>
              )}
            </span>
          )}
        </div>
        <table className="m-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: 'var(--surface2)', textAlign: 'right' }}>
            {['الموظف', 'الجهات', 'مفتوحة', 'لمسات أسبوعية', 'معدل التحويل', 'مهام مفتوحة', 'مهام منجزة', 'صفقات مفتوحة', 'ربح فعلي'].map(h =>
              <th key={h} style={{ padding: '10px 12px', fontSize: 11.5, color: 'var(--muted)' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {(s.byOwner || []).map(row => (
              <tr key={row.ownerId || 'none'} style={{ borderTop: '1px solid var(--border)' }}>
                <td data-label="الموظف" style={{ padding: '10px 12px', fontWeight: 800 }}>{employeeName(row.ownerId)}</td>
                <td data-label="الجهات" style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)' }}>{fmt0(row.assignedLeads)}</td>
                <td data-label="مفتوحة" style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', color: row.openLeads ? 'var(--green)' : 'var(--muted)' }}>{fmt0(row.openLeads)}</td>
                <td data-label="لمسات أسبوعية" style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', color: targets.touches7d ? (row.touchesThisWeek >= targets.touches7d ? 'var(--green)' : 'var(--red)') : (row.touchesThisWeek ? 'var(--accent3)' : 'var(--muted)') }}>
                  {fmt0(row.touchesThisWeek)}{targets.touches7d ? ` / ${targets.touches7d}` : ''}
                </td>
                <td data-label="معدل التحويل" style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)' }}>
                  {(() => { const o = convByOwner.get(row.ownerId); return o
                    ? <span style={{ color: o.conversionPct >= 10 ? 'var(--green)' : o.conversionPct > 0 ? 'var(--gold)' : 'var(--muted)' }}>{o.conversionPct}% <span style={{ fontSize: 10, color: 'var(--muted2)' }}>({fmt0(o.returned)}/{fmt0(o.worked)})</span></span>
                    : <span style={{ color: 'var(--muted2)' }}>—</span>; })()}
                </td>
                <td data-label="مهام مفتوحة" style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', color: row.tasksOpen ? 'var(--gold)' : 'var(--muted)' }}>{fmt0(row.tasksOpen)}</td>
                <td data-label="مهام منجزة" style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)' }}>{fmt0(row.tasksDoneThisWeek)}</td>
                <td data-label="صفقات مفتوحة" style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)' }}>{fmt0(row.dealsOpen)}</td>
                <td data-label="ربح فعلي" style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', color: row.wonValue ? 'var(--green)' : 'var(--muted)' }}>{fmt0(row.wonValue)} ر.س</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Pad>
  );
}

function MyStat({ label, v, c }) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-mono)', color: c }}>{v}</span>
    </span>
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
      {item.is_terminal && <span style={{ fontSize: 10, color: 'var(--red)' }}>منتهية</span>}
      {dirty && <Btn size="sm" variant="accent" disabled={busy} onClick={save}>حفظ</Btn>}
      <Btn size="sm" variant="danger" title="حذف" icon={<Trash2 size={14}/>} onClick={async () => { if (!confirm(`حذف «${item.label_ar}»؟`)) return; try { await del(item.id); toast('حُذف', 'success'); onChange(); } catch (e) { toast(e.message, 'error'); } }}/>
    </div>
  );
}

// helpers
function Pad({ children }) { return <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>{children}</div>; }
function Spin() { return <div style={{ padding: 50, textAlign: 'center' }}><Spinner/></div>; }
function Hd({ label, value, color }) { return <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</div><div style={{ fontSize: 14, fontWeight: 700, color: color || 'var(--text)' }}>{value}</div></div>; }
function MiniBtn({ color, label, onClick }) {
  return <button onClick={onClick} style={{ border: `1px solid ${color}`, background: `${color}15`, color, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>{label}</button>;
}
