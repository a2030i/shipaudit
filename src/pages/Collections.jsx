// "قائمة التحصيل" — operator-facing work queue for chasing debt.
//
// Designed around the operator's day: open the page, see a sorted
// list of customers who need attention, work through them one by
// one. Each task carries the trigger (why we're chasing), the debt
// at creation, and the current stage.
//
// Flow per task:
//   1. Click row → drawer opens with customer details
//   2. Quick actions: تواصلت / وعد دفع / مكتمل / أجّل / ألغ
//   3. "وعد دفع" captures amount + date — task stays open until
//      that date, then auto-surfaces for follow-up.
//
// Task generation: clicking "تحديث القائمة" runs the auto-gen pass
// against the latest receivables snapshot. Existing open tasks are
// preserved (unique partial index handles dedupe), new ones get
// added.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { rtl } from '../lib/xlsxRtl.js';
import {
  RefreshCw, Phone, CheckCircle2, Clock, X, AlertTriangle, Download,
  Inbox, MessageSquare, Calendar, Sparkles, Edit3, Plus, ChevronLeft, Trash2, UserPlus,
} from 'lucide-react';
import {
  Card, Btn, Spinner, Empty, Modal, toast, PageHeader,
} from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  TRIGGER_LABELS, STAGE_LABELS,
  listTasks, regenerateTasks, updateTaskStage, recordPromise,
  completePromise, breakPromise, snoozeTask, cancelTask, deleteTask,
  loadCollectionCandidates, dunningLevel, DUNNING_LEVELS, loadAgingTrend,
  loadCollectionAssignmentCandidates, assignCollectionTasks,
} from '../lib/collectionsService.js';
import {
  requestWriteoff, approveWriteoff, rejectWriteoff, listWriteoffs,
  WRITEOFF_STATUS_LABELS,
} from '../lib/writeoffsService.js';

const fmt = (n) =>
  n == null || Number.isNaN(n) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCompact = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1_000) return (n / 1_000).toFixed(1) + 'ك';
  return n.toFixed(0);
};
const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-GB', { dateStyle: 'medium' }); }
  catch { return iso; }
};
const fmtRel = (iso) => {
  if (!iso) return '—';
  const days = Math.floor((Date.now() - new Date(iso)) / 86_400_000);
  if (days <= 0) return 'اليوم';
  if (days === 1) return 'أمس';
  if (days < 7)   return `قبل ${days} أيام`;
  if (days < 30)  return `قبل ${Math.floor(days / 7)} أسابيع`;
  return `قبل ${Math.floor(days / 30)} شهور`;
};

const STAGE_COLORS = {
  todo:      'var(--accent3)',
  contacted: 'var(--accent)',
  promised:  'var(--gold)',
  done:      'var(--green)',
  snoozed:   '#6B7280',
  cancelled: '#9CA3AF',
};
const TRIGGER_COLORS = {
  over_credit_limit:  '#B91C1C',
  aged_90:            'var(--red)',
  aged_60:            'color-mix(in srgb, var(--gold) 50%, var(--red))',
  aged_30:            'var(--gold)',
  prepaid_with_debt:  '#EF4444',
  manual:             'var(--accent3)',
};
const OPEN_STAGES = ['todo', 'contacted', 'promised', 'snoozed'];
const PROMISE_STATUS_LABELS = {
  pending: 'بانتظار السداد',
  partial: 'سداد جزئي',
  honored: 'تحقق',
  broken: 'لم يتحقق',
};
const DAILY_COLLECTION_LIMIT = 25;
const RIYADH_TODAY = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

export default function Collections({ isActive = true }) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { profile, can } = useAuth();
  const canApproveWriteoff = can('receivables.approve_writeoff');
  const canRequestWriteoff = can('receivables.request_writeoff');
  const canRegenerate = can('collections.regenerate');
  const canUpdateStage = can('collections.update_stage');
  const canRecordPromise = can('collections.record_promise');
  const canAssign = can('collections.assign');
  const [loading, setLoading]   = useState(true);
  const [tasks, setTasks]       = useState([]);
  const [customers, setCustomers] = useState([]);  // for regenerate + lookup
  const [stageFilter, setStageFilter] = useState('open');  // open|all|<stage>
  const [workScope, setWorkScope] = useState('today'); // today|backlog
  const [drawer, setDrawer]     = useState(null);
  const [ptpOpen, setPtpOpen]   = useState(null);
  const [snoozeOpen, setSnoozeOpen] = useState(null);
  const [writeoffOpen, setWriteoffOpen] = useState(null);   // task being written off
  const [pendingWriteoffs, setPendingWriteoffs] = useState([]);
  const [reviewQueueOpen, setReviewQueueOpen]   = useState(false);
  const [agingTrend, setAgingTrend] = useState(null);
  const [candidatesReady, setCandidatesReady] = useState(false);
  const [assignmentCandidates, setAssignmentCandidates] = useState([]);
  const [selectedTasks, setSelectedTasks] = useState(new Set());
  const [bulkAssignee, setBulkAssignee] = useState('');
  const [assigning, setAssigning] = useState(false);
  const focusedCustomer = searchParams.get('customer')?.trim() || '';

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      let candidatesOk = true;
      const [recs, pending, trend, collectors] = await Promise.all([
        loadCollectionCandidates().catch((e) => {
          candidatesOk = false;
          console.warn('Failed to load live collection candidates', e);
          return null;
        }),   // دين زوهو الحيّ (كان snapshot)
        listWriteoffs({ status: 'pending' }).catch(() => []),
        loadAgingTrend().catch(() => null),
        canAssign ? loadCollectionAssignmentCandidates().catch(() => []) : Promise.resolve([]),
      ]);
      const liveCustomers = Array.isArray(recs) ? recs : [];
      const t = await listTasks({ includeDone: stageFilter !== 'open' });
      setTasks(t);
      setCustomers(liveCustomers);
      setCandidatesReady(candidatesOk);
      setPendingWriteoffs(pending);
      setAgingTrend(trend);
      setAssignmentCandidates(collectors);
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setLoading(false);
  }, [stageFilter, canAssign]);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh, location.pathname]);

  const customerByName = useMemo(
    () => new Map(customers.map(c => [c.name, c])),
    [customers],
  );
  const isLiveTask = useCallback((task) => {
    if (!candidatesReady) return true;
    if (!OPEN_STAGES.includes(task.stage) || task.trigger === 'manual') return true;
    return (Number(customerByName.get(task.customer_name)?.total) || 0) > 0.5;
  }, [candidatesReady, customerByName]);
  const taskDebt = useCallback((task) => {
    const live = Number(customerByName.get(task.customer_name)?.total);
    return Number.isFinite(live) && live > 0.5 ? live : (Number(task.debt_at_creation) || 0);
  }, [customerByName]);

  const handleRegenerate = async () => {
    try {
      const r = await regenerateTasks({ customers, userId: profile?.id || null });
      if (r.created > 0) {
        toast(`أضيفت ${r.created} مهمة جديدة · أُغلقت ${r.closed || 0} · أُعيد توزيع ${r.reassigned || 0}`, 'success');
      } else {
        toast(`القائمة متزامنة مع زوهو · أُغلقت ${r.closed || 0} · أُعيد توزيع ${r.reassigned || 0}`, 'info');
      }
      await refresh();
    } catch (e) { toast(`فشل: ${e.message}`, 'error'); }
  };

  // Filter + sort tasks for the visible table.
  const prioritizedTasks = useMemo(() => {
    let pool = tasks;
    if (stageFilter === 'open') {
      pool = pool.filter(t => OPEN_STAGES.includes(t.stage));
    } else if (stageFilter !== 'all') {
      pool = pool.filter(t => t.stage === stageFilter);
    }
    if (focusedCustomer) pool = pool.filter(t => t.customer_name === focusedCustomer);
    pool = pool.filter(isLiveTask);
    // حاجز احتياطي: مهمة واحدة لكل عميل (الأكثر تقدّماً) — يمنع أي تكرار
    // متبقٍ من بيانات قديمة قبل إصلاح regenerateTasks.
    const rank = { promised: 4, contacted: 3, snoozed: 2, todo: 1 };
    const byCustomer = new Map();
    for (const t of pool) {
      const cur = byCustomer.get(t.customer_name);
      if (!cur || (rank[t.stage] || 0) > (rank[cur.stage] || 0)) byCustomer.set(t.customer_name, t);
    }
    const deduped = [...byCustomer.values()];
    // يوم المحصّل: الوعد المتأخر/اليوم، ثم التأجيل المنتهي، ثم الخلل
    // المالي، ثم الأقدم والأعلى مبلغاً. المخزون لا يتحول كله إلى عمل اليوم.
    const today = RIYADH_TODAY();
    const priorityOf = (task) => {
      if (task.stage === 'promised' && task.promise_date && task.promise_date < today) return 0;
      if (task.stage === 'promised' && task.promise_date === today) return 1;
      if (task.stage === 'snoozed' && task.snooze_until && new Date(task.snooze_until) <= new Date()) return 2;
      if (task.trigger === 'prepaid_with_debt') return 3;
      if (task.trigger === 'over_credit_limit') return 4;
      if (task.trigger === 'aged_90') return 5;
      if (task.trigger === 'aged_60') return 6;
      if (task.trigger === 'aged_30') return 7;
      return 8;
    };
    return deduped.sort((a, b) => {
      const priorityDiff = priorityOf(a) - priorityOf(b);
      if (priorityDiff) return priorityDiff;
      return taskDebt(b) - taskDebt(a);
    });
  }, [tasks, stageFilter, focusedCustomer, isLiveTask, taskDebt]);

  const visibleTasks = useMemo(() => {
    if (stageFilter !== 'open') return prioritizedTasks;
    return workScope === 'today'
      ? prioritizedTasks.slice(0, DAILY_COLLECTION_LIMIT)
      : prioritizedTasks.slice(DAILY_COLLECTION_LIMIT);
  }, [prioritizedTasks, stageFilter, workScope]);

  const collectorById = useMemo(
    () => new Map(assignmentCandidates.map(employee => [employee.id, employee])),
    [assignmentCandidates],
  );
  const visibleTaskIds = useMemo(() => new Set(visibleTasks.map(task => task.id)), [visibleTasks]);
  const allVisibleSelected = visibleTasks.length > 0 && visibleTasks.every(task => selectedTasks.has(task.id));

  useEffect(() => {
    setSelectedTasks(current => {
      const next = new Set([...current].filter(id => visibleTaskIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [visibleTaskIds]);

  const toggleTaskSelection = (taskId) => {
    setSelectedTasks(current => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const toggleVisibleSelection = () => {
    setSelectedTasks(allVisibleSelected ? new Set() : new Set(visibleTasks.map(task => task.id)));
  };

  const handleBulkAssignment = async (assigneeId) => {
    if (!selectedTasks.size) return;
    setAssigning(true);
    try {
      const result = await assignCollectionTasks([...selectedTasks], assigneeId || null);
      const assignee = assignmentCandidates.find(employee => employee.id === assigneeId);
      toast(
        assigneeId
          ? `أُسندت ${result.updated || 0} مهمة إلى ${assignee?.name || 'الموظف'}`
          : `أُلغي إسناد ${result.updated || 0} مهمة`,
        'success',
      );
      setSelectedTasks(new Set());
      await refresh();
    } catch (error) {
      toast(`تعذّر الإسناد: ${error.message}`, 'error');
    } finally {
      setAssigning(false);
    }
  };

  const stats = useMemo(() => {
    const open    = tasks.filter(t => OPEN_STAGES.includes(t.stage) && isLiveTask(t));
    const promised = open.filter(t => t.stage === 'promised');
    const promiseDueToday = promised.filter(t => {
      if (!t.promise_date) return false;
      const d = new Date(t.promise_date);
      const today = new Date();
      return d.toDateString() === today.toDateString();
    });
    const promiseOverdue = promised.filter(t => {
      if (!t.promise_date) return false;
      return new Date(t.promise_date) < new Date();
    });
    return {
      open: open.length,
      todo: open.filter(t => t.stage === 'todo').length,
      contacted: open.filter(t => t.stage === 'contacted').length,
      promised: promised.length,
      promiseDueToday: promiseDueToday.length,
      promiseOverdue: promiseOverdue.length,
      totalDebt: +open.reduce((s, t) => s + taskDebt(t), 0).toFixed(2),
      daily: Math.min(open.length, DAILY_COLLECTION_LIMIT),
      backlog: Math.max(0, open.length - DAILY_COLLECTION_LIMIT),
    };
  }, [tasks, isLiveTask, taskDebt]);

  // صحة أعمار الذمم + توزيع مستويات التصعيد (من دين زوهو الحيّ — بند ب+ج).
  // متوسط عمر الدين = مرجّح بالمبلغ (مؤشّر DSO مبسّط، دائماً محسوب بلا مبيعات).
  const arHealth = useMemo(() => {
    const withDebt = customers.filter(c => (Number(c.total) || 0) > 0.5);
    const totalDebt = withDebt.reduce((s, c) => s + (Number(c.total) || 0), 0);
    const wAge = totalDebt
      ? withDebt.reduce((s, c) => s + (Number(c.total) || 0) * (Number(c.daysOutstanding) || 0), 0) / totalDebt
      : 0;
    const byLevel = new Map(DUNNING_LEVELS.map(l => [l.key, { ...l, count: 0, total: 0 }]));
    for (const c of withDebt) {
      const e = byLevel.get(dunningLevel(c.daysOutstanding).key);
      e.count++; e.total += Number(c.total) || 0;
    }
    return { avgAge: Math.round(wAge), levels: [...byLevel.values()], totalDebt, count: withDebt.length };
  }, [customers]);

  const exportTasks = () => {
    if (!visibleTasks.length) { toast('لا توجد مهام', 'info'); return; }
    const headers = [
      'العميل', 'السبب', 'المرحلة', 'الدين عند الإنشاء',
      'الأيام منذ آخر فاتورة', 'وعد بالدفع', 'تاريخ الوعد',
      'المسؤول', 'منشأة في', 'الملاحظات',
    ];
    const rows = visibleTasks.map(t => [
      t.customer_name,
      TRIGGER_LABELS[t.trigger] || t.trigger,
      STAGE_LABELS[t.stage] || t.stage,
      taskDebt(t),
      t.days_outstanding,
      t.promise_amount || '',
      t.promise_date || '',
      collectorById.get(t.assigned_to)?.name || (t.assigned_to ? 'موظف' : 'بلا مسؤول'),
      t.created_at,
      t.notes || '',
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'قائمة التحصيل');
    XLSX.writeFile(rtl(wb), `قائمة_التحصيل_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast(`تم تصدير ${visibleTasks.length} مهمة`, 'success');
  };

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320 }}>
          <Spinner size={28}/>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader
        icon={<Phone size={22}/>}
        iconColor="var(--red)"
        title="قائمة التحصيل"
        subtitle="ابدأ بوعود الدفع والمخاطر الأعلى — هذه قائمة يوم وليست كل المديونين"
        meta={`${stats.daily} لليوم · ${stats.backlog} في المخزون · ${fmt(stats.totalDebt)} ر.س مفتوح`}
        actions={
          <div style={{ display: 'flex', gap: 6 }}>
            {canRegenerate && (
              <Btn size="sm" variant="primary" icon={<Sparkles size={13}/>} onClick={handleRegenerate}>
                مزامنة من زوهو
              </Btn>
            )}
            <Btn size="sm" variant="ghost" icon={<Download size={13}/>} onClick={exportTasks} disabled={!visibleTasks.length}>
              تصدير
            </Btn>
            <Btn size="sm" variant="ghost" icon={<RefreshCw size={13}/>} onClick={refresh}>
              تحديث
            </Btn>
          </div>
        }
      />

      {focusedCustomer && (
        <Card className="collection-focus-banner" style={{ marginBottom: 14, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>مهمة العميل: {focusedCustomer}</div>
              <div style={{ marginTop: 3, fontSize: 11, color: 'var(--muted)' }}>انتقلت من بطاقة الدين إلى مهمة المتابعة لنفس العميل.</div>
            </div>
            <Btn size="sm" variant="ghost" onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('customer');
              setSearchParams(next);
            }}>
              عرض كل المهام
            </Btn>
          </div>
        </Card>
      )}

      <Card style={{
        marginBottom: 16, padding: 16,
        background: 'color-mix(in srgb, var(--accent3) 7%, var(--card))',
        border: '1px solid color-mix(in srgb, var(--accent3) 24%, var(--border))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>
              خطة اليوم: {stats.daily} حسابًا مرتبة حسب الاستحقاق والخطر
            </div>
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
              الوعود المتأخرة أولًا، ثم التأجيل المنتهي، ثم الحالات المالية الحرجة. لا يُطلب من الموظف معالجة المخزون كاملًا.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn size="sm" variant={workScope === 'today' ? 'primary' : 'outline'}
                 onClick={() => { setStageFilter('open'); setWorkScope('today'); }}>
              عمل اليوم ({stats.daily})
            </Btn>
            <Btn size="sm" variant={workScope === 'backlog' ? 'primary' : 'outline'}
                 onClick={() => { setStageFilter('open'); setWorkScope('backlog'); }}>
              المخزون ({stats.backlog})
            </Btn>
          </div>
        </div>
      </Card>

      {/* Stats strip */}
      <div style={{
        display: 'grid', gap: 12, marginBottom: 16,
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      }}>
        <SummaryStat label="مفتوحة"        value={stats.open}             color="var(--accent3)"/>
        <SummaryStat label="جديدة"          value={stats.todo}             color="var(--accent3)"/>
        <SummaryStat label="بانتظار الردّ"   value={stats.contacted}        color="var(--accent)"/>
        <SummaryStat label="وعود فعّالة"     value={stats.promised}         color="var(--gold)"/>
        <SummaryStat label="وعود اليوم"      value={stats.promiseDueToday}  color="var(--green)"/>
        <SummaryStat label="وعود متأخّرة"    value={stats.promiseOverdue}   color="var(--red)"/>
        <SummaryStat label="متوسط عمر الدين" value={`${arHealth.avgAge} يوم`} color="var(--gold)"/>
      </div>

      {/* مستويات التصعيد — توزيع الدين الحيّ (زوهو) على مراحل المطالبة (ب+ج).
          التصعيد بالأولوية: الأقدم يُلاحَق أولاً وبنبرة أشدّ. */}
      {arHealth.totalDebt > 0.5 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {arHealth.levels.filter(l => l.count > 0).map(l => (
            <div key={l.key} title={`${l.count} عميل · ${fmt(l.total)} ر.س`} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 10,
              border: `1px solid ${l.color}`, background: `color-mix(in srgb, ${l.color} 8%, transparent)`,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: l.color, flexShrink: 0 }}/>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{l.label}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{l.count} · {fmtCompact(l.total)}</span>
            </div>
          ))}
        </div>
      )}

      {/* حركة الأعمار شهر-بشهر (roll-rate) — ج. قبل توفّر شهرين: قيد التجميع. */}
      {agingTrend && (
        !agingTrend.hasHistory ? (
          <div style={{ marginBottom: 16, fontSize: 11.5, color: 'var(--muted)', padding: '8px 12px',
            borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--border)' }}>
            📈 تغيّر أعمار الديون — التقط الخادم لقطة {agingTrend.cur?.period || ''}
            {agingTrend.cur?.capturedAt ? ` في ${new Date(agingTrend.cur.capturedAt).toLocaleString('ar-SA')}` : ''}.
            تبدأ المقارنة تلقائيًا عند توفر شهرين مكتملين.
          </div>
        ) : (() => {
          const { cur, prev } = agingTrend;
          const buckets = [
            { key: 'b0_30', label: '0–30' }, { key: 'b31_60', label: '31–60' },
            { key: 'b61_90', label: '61–90' }, { key: 'b90p', label: '+90' },
          ];
          const roll90 = (cur.b90p || 0) - (prev.b90p || 0);
          return (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16,
              fontSize: 11.5, padding: '8px 12px', borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--border)' }}>
              <span style={{ fontWeight: 700, color: 'var(--text)' }}>📈 تغيّر أعمار الديون {prev.period}→{cur.period}:</span>
              {buckets.map(b => {
                const delta = (cur[b.key] || 0) - (prev[b.key] || 0);
                const worse = (b.key === 'b61_90' || b.key === 'b90p') && delta > 0;
                const col = Math.abs(delta) < 0.5 ? 'var(--muted)' : worse ? 'var(--red)' : delta < 0 ? 'var(--green)' : 'var(--muted)';
                return (
                  <span key={b.key} style={{ color: 'var(--text2)' }}>
                    {b.label}: <b style={{ color: col, fontFamily: 'var(--font-mono)' }}>{delta >= 0 ? '▲' : '▼'} {fmtCompact(Math.abs(delta))}</b>
                  </span>
                );
              })}
              <span style={{ marginInlineStart: 'auto', fontWeight: 700,
                color: roll90 > 0.5 ? 'var(--red)' : roll90 < -0.5 ? 'var(--green)' : 'var(--muted)' }}>
                صافي ما انتقل لفئة +90 يوم: {roll90 >= 0 ? '+' : '−'}{fmtCompact(Math.abs(roll90))} ر.س
              </span>
            </div>
          );
        })()
      )}

      {/* Pending write-offs banner — shows when there are requests
          awaiting admin approval. Admins click to open the review
          queue. */}
      {/* Banner is only clickable for the admin / users with the
          approve permission — accountants without it still see the
          count (transparency) but the click does nothing. */}
      {pendingWriteoffs.length > 0 && canApproveWriteoff && (
        <Card
          style={{
            marginBottom: 14,
            background: 'color-mix(in srgb, var(--gold) 8%, transparent)',
            border: '1.5px solid color-mix(in srgb, var(--gold) 30%, transparent)',
            cursor: 'pointer',
          }}
          onClick={() => setReviewQueueOpen(true)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <AlertTriangle size={16} color="var(--gold)"/>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', flex: 1 }}>
              {pendingWriteoffs.length} طلب شطب دين بانتظار الموافقة
              <span style={{ marginInlineStart: 10, fontSize: 11.5, color: 'var(--muted)', fontWeight: 500 }}>
                إجمالي {fmt(pendingWriteoffs.reduce((s, w) => s + Number(w.amount || 0), 0))} ر.س
              </span>
            </span>
            <ChevronLeft size={14} color="var(--muted)"/>
          </div>
        </Card>
      )}

      {/* Stage filter chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {['open', 'todo', 'contacted', 'promised', 'snoozed', 'done', 'cancelled', 'all'].map(s => (
          <button key={s} onClick={() => setStageFilter(s)} style={{
            padding: '6px 14px', borderRadius: 999, cursor: 'pointer',
            border: `1.5px solid ${stageFilter === s ? '#EF4444' : 'var(--border)'}`,
            background: stageFilter === s ? 'rgba(239,68,68,.12)' : 'transparent',
            color: stageFilter === s ? 'var(--red)' : 'var(--text2)',
            fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--font-sans)',
          }}>
            {s === 'open' ? (workScope === 'today' ? 'عمل اليوم' : 'مخزون مفتوح') : s === 'all' ? 'الكل' : STAGE_LABELS[s] || s}
          </button>
        ))}
      </div>

      {canAssign && visibleTasks.length > 0 && (
        <Card className="collection-assignment-bar" style={{ marginBottom: 14, padding: 12 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 750, color: 'var(--text)' }}>
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleVisibleSelection}/>
              تحديد المعروض ({visibleTasks.length})
            </label>
            <span style={{ fontSize: 11.5, color: selectedTasks.size ? 'var(--accent3)' : 'var(--muted)', fontWeight: 700 }}>
              المحدد: {selectedTasks.size}
            </span>
            <select
              value={bulkAssignee}
              onChange={(event) => setBulkAssignee(event.target.value)}
              disabled={!assignmentCandidates.length || assigning}
              aria-label="موظف التحصيل المسؤول"
              style={{ minWidth: 210, minHeight: 40, marginInlineStart: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: '7px 10px', color: 'var(--text)', background: 'var(--card)', fontFamily: 'inherit' }}
            >
              <option value="">اختر موظف التحصيل…</option>
              {assignmentCandidates.map(employee => (
                <option key={employee.id} value={employee.id}>
                  {employee.name} · {employee.openTasks} مهام مفتوحة
                </option>
              ))}
            </select>
            <Btn
              size="sm"
              variant="primary"
              icon={<UserPlus size={14}/>}
              disabled={!selectedTasks.size || !bulkAssignee || assigning}
              onClick={() => handleBulkAssignment(bulkAssignee)}
            >
              إسناد المحدد
            </Btn>
            <Btn
              size="sm"
              variant="ghost"
              disabled={!selectedTasks.size || assigning}
              onClick={() => handleBulkAssignment(null)}
            >
              إلغاء الإسناد
            </Btn>
          </div>
          {!assignmentCandidates.length && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--gold)' }}>
              لا يوجد موظف يملك صلاحيتَي عرض قائمة التحصيل وتحديث مرحلتها. جهّز صلاحيات الموظف أولاً.
            </div>
          )}
        </Card>
      )}

      {/* Tasks table */}
      {visibleTasks.length === 0 ? (
        <Empty
          icon="✓"
          title={workScope === 'backlog' && stageFilter === 'open' ? 'لا يوجد مخزون مؤجل' : 'لا توجد مهام في هذا التبويب'}
          sub={canRegenerate ? "اضغط «مزامنة من زوهو» لتحديث القائمة عند الحاجة" : 'لا توجد حالات مسندة لك الآن'}
        />
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <table className="m-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                {canAssign && (
                  <th aria-label="تحديد" style={{ width: 42, padding: '10px 8px' }}/>
                )}
                {['العميل', 'السبب', 'المرحلة', 'الدين', 'عمر الدين', 'الوعد', 'المسؤول', 'إجراء'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleTasks.map(t => {
                const c = customerByName.get(t.customer_name);
                const isOverdueSnooze = t.stage === 'snoozed' && t.snooze_until && new Date(t.snooze_until) < new Date();
                const isPromiseOverdue = t.stage === 'promised' && t.promise_date && new Date(t.promise_date) < new Date();
                return (
                  <tr key={t.id} style={{
                    borderBottom: '1px solid var(--border)',
                    background: isOverdueSnooze || isPromiseOverdue ? 'color-mix(in srgb, var(--red) 4%, transparent)' : 'transparent',
                    cursor: 'pointer',
                  }} onClick={() => setDrawer(t)}>
                    {canAssign && (
                      <td data-label="تحديد" style={{ padding: '10px 8px' }} onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedTasks.has(t.id)}
                          onChange={() => toggleTaskSelection(t.id)}
                          aria-label={`تحديد مهمة ${t.customer_name}`}
                        />
                      </td>
                    )}
                    <td data-label="" style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text)' }}>
                      {t.customer_name}
                      {c?.merchant?.phone && (
                        <div style={{ fontSize: 10.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)', direction: 'ltr', textAlign: 'right', marginTop: 2 }}>
                          {c.merchant.phone}
                        </div>
                      )}
                    </td>
                    <td data-label="السبب" style={{ padding: '10px 12px' }}>
                      <span style={pill(TRIGGER_COLORS[t.trigger])}>
                        {TRIGGER_LABELS[t.trigger] || t.trigger}
                      </span>
                    </td>
                    <td data-label="المرحلة" style={{ padding: '10px 12px' }}>
                      <span style={pill(STAGE_COLORS[t.stage])}>
                        {STAGE_LABELS[t.stage] || t.stage}
                      </span>
                    </td>
                    <td data-label="الدين" style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--red)' }}>
                      {fmtCompact(taskDebt(t))}
                    </td>
                    <td data-label="عمر الدين" style={{ padding: '10px 12px', fontSize: 11, color: 'var(--muted)' }}>
                      {(() => {
                        // العمر الحيّ من دين زوهو (candidate) لا المخزَّن عند الإنشاء
                        const days = c?.daysOutstanding ?? t.days_outstanding;
                        if (days == null) return '—';
                        const lv = dunningLevel(days);
                        return (<>
                          {`${days} يوم`}
                          <div style={{ marginTop: 3, display: 'inline-flex', padding: '1px 7px', borderRadius: 999,
                            fontSize: 9.5, fontWeight: 700, color: lv.color,
                            background: `color-mix(in srgb, ${lv.color} 12%, transparent)` }}>
                            {lv.label}
                          </div>
                        </>);
                      })()}
                    </td>
                    <td data-label="الوعد" style={{ padding: '10px 12px', fontSize: 11 }}>
                      {t.stage === 'promised' ? (
                        <span style={{ color: isPromiseOverdue ? 'var(--red)' : 'var(--gold)', fontWeight: 600 }}>
                          {fmtCompact(t.promise_amount)} يوم {fmtDate(t.promise_date)}
                          {Number(t.promise_paid_amount) > 0.5 && (
                            <small style={{ display: 'block', marginTop: 2, color: 'var(--green)' }}>
                              رُصد {fmtCompact(Number(t.promise_paid_amount))}
                            </small>
                          )}
                          {isPromiseOverdue && ' ⚠'}
                        </span>
                      ) : t.stage === 'snoozed' ? (
                        <span style={{ color: isOverdueSnooze ? 'var(--red)' : 'var(--muted)' }}>
                          مؤجّلة حتى {fmtDate(t.snooze_until)}
                          {isOverdueSnooze && ' ⚠'}
                        </span>
                      ) : '—'}
                    </td>
                    <td data-label="المسؤول" style={{ padding: '10px 12px', fontSize: 11.5, fontWeight: 650, color: t.assigned_to ? 'var(--text)' : 'var(--gold)' }}>
                      {collectorById.get(t.assigned_to)?.name || (t.assigned_to ? 'موظف' : 'بلا مسؤول')}
                    </td>
                    <td data-label="إجراء" style={{ padding: '10px 12px' }} onClick={(e) => e.stopPropagation()}>
                      {canUpdateStage ? (
                        <QuickActions task={t}
                          canPromise={canRecordPromise}
                          onContact={async () => { await updateTaskStage(t.id, 'contacted'); refresh(); }}
                          onPromise={() => setPtpOpen(t)}
                          onDone={async () => { await updateTaskStage(t.id, 'done', { userId: profile?.id }); refresh(); }}
                          onSnooze={() => setSnoozeOpen(t)}
                          onCancel={async () => {
                            if (confirm('إلغاء هذه المهمة؟')) {
                              await cancelTask(t.id, 'ملغاة من العامل');
                              refresh();
                            }
                          }}
                        />
                      ) : <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>عرض فقط</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* Drawer / dialogs */}
      {drawer && (
        <TaskDrawer
          task={drawer}
          customer={customerByName.get(drawer.customer_name)}
          onClose={() => setDrawer(null)}
          onRefresh={refresh}
          onPromise={canRecordPromise ? () => { setPtpOpen(drawer); setDrawer(null); } : null}
          onWriteoff={canRequestWriteoff ? () => { setWriteoffOpen(drawer); setDrawer(null); } : null}
          canUpdate={canUpdateStage}
        />
      )}
      {writeoffOpen && (
        <WriteoffRequestDialog
          task={writeoffOpen}
          onCancel={() => setWriteoffOpen(null)}
          onConfirm={async ({ amount, reason }) => {
            try {
              await requestWriteoff({
                customerName: writeoffOpen.customer_name,
                amount,
                reason,
                taskId: writeoffOpen.id,
                userId:  profile?.id || null,
              });
              toast('تم إرسال طلب الشطب — بانتظار الموافقة', 'success');
              setWriteoffOpen(null);
              await refresh();
            } catch (e) { toast(`فشل: ${e.message}`, 'error'); }
          }}
        />
      )}
      {reviewQueueOpen && (
        <ReviewQueueModal
          pending={pendingWriteoffs}
          onClose={() => setReviewQueueOpen(false)}
          onApprove={async (id, note) => {
            try {
              await approveWriteoff(id, { note, userId: profile?.id || null });
              toast('تم اعتماد الشطب', 'success');
              await refresh();
            } catch (e) { toast(`فشل: ${e.message}`, 'error'); }
          }}
          onReject={async (id, reason) => {
            try {
              await rejectWriteoff(id, { reason, userId: profile?.id || null });
              toast('تم رفض الطلب', 'info');
              await refresh();
            } catch (e) { toast(`فشل: ${e.message}`, 'error'); }
          }}
        />
      )}
      {ptpOpen && (
        <PromiseDialog
          task={ptpOpen}
          onCancel={() => setPtpOpen(null)}
          onConfirm={async ({ amount, date, notes }) => {
            try {
              await recordPromise(ptpOpen.id, { amount, date, notes });
              toast('تم تسجيل وعد الدفع', 'success');
              setPtpOpen(null);
              await refresh();
            } catch (e) { toast(`فشل: ${e.message}`, 'error'); }
          }}
        />
      )}
      {snoozeOpen && (
        <SnoozeDialog
          task={snoozeOpen}
          onCancel={() => setSnoozeOpen(null)}
          onConfirm={async (until) => {
            try {
              await snoozeTask(snoozeOpen.id, until);
              toast('تم التأجيل', 'success');
              setSnoozeOpen(null);
              await refresh();
            } catch (e) { toast(`فشل: ${e.message}`, 'error'); }
          }}
        />
      )}
    </div>
  );
}

const pill = (color) => ({
  display: 'inline-flex', alignItems: 'center',
  padding: '2px 8px', borderRadius: 999,
  background: `color-mix(in srgb, ${color} 14%, transparent)`,
  color, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap',
});

function SummaryStat({ label, value, color }) {
  return (
    <div className="stat-card" style={{
      padding: 12,
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)',
      '--sc-tone': color,
    }}>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 600, letterSpacing: .3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: 'var(--font-mono)', letterSpacing: -0.4 }}>
        {value.toLocaleString('en-US')}
      </div>
    </div>
  );
}

function QuickActions({ task, canPromise, onContact, onPromise, onDone, onSnooze, onCancel }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {task.stage === 'todo' && (
        <Btn size="sm" variant="ghost" title="تواصلت" icon={<MessageSquare size={11}/>} onClick={onContact}/>
      )}
      {canPromise && (task.stage === 'todo' || task.stage === 'contacted') && (
        <Btn size="sm" variant="ghost" title="وعد دفع" icon={<Calendar size={11}/>} onClick={onPromise}/>
      )}
      <Btn size="sm" variant="ghost" title="مكتملة" icon={<CheckCircle2 size={11}/>} onClick={onDone}/>
      <Btn size="sm" variant="ghost" title="أجّل" icon={<Clock size={11}/>} onClick={onSnooze}/>
      <Btn size="sm" variant="danger" title="ألغ" icon={<X size={11}/>} onClick={onCancel}/>
    </div>
  );
}

function TaskDrawer({ task, customer, onClose, onRefresh, onPromise, onWriteoff, canUpdate }) {
  return (
    <Modal title={`مهمة تحصيل — ${task.customer_name}`} onClose={onClose} width={560}>
      <div style={{ padding: '4px 4px 0' }}>
        <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
          <KV label="السبب" value={
            <span style={pill(TRIGGER_COLORS[task.trigger])}>{TRIGGER_LABELS[task.trigger]}</span>
          }/>
          <KV label="المرحلة" value={
            <span style={pill(STAGE_COLORS[task.stage])}>{STAGE_LABELS[task.stage]}</span>
          }/>
          <KV label="الدين عند الإنشاء" value={`${fmt(task.debt_at_creation)} ر.س`}/>
          {task.credit_limit != null && <KV label="السقف الائتماني" value={`${fmt(task.credit_limit)} ر.س`}/>}
          {task.days_outstanding != null && <KV label="عمر الدين" value={`${task.days_outstanding} يوم`}/>}
          {customer?.merchant?.phone && (
            <KV label="الهاتف" value={
              <span style={{ fontFamily: 'var(--font-mono)', direction: 'ltr', textAlign: 'right' }}>
                {customer.merchant.phone}
              </span>
            }/>
          )}
          {task.promise_amount && (
            <KV label="الوعد الحالي" value={`${fmt(task.promise_amount)} ر.س يوم ${fmtDate(task.promise_date)}`}/>
          )}
          {task.promise_status && (
            <KV label="تحقق الوعد" value={
              `${PROMISE_STATUS_LABELS[task.promise_status] || task.promise_status} · رُصد ${fmt(Number(task.promise_paid_amount) || 0)} ر.س`
            }/>
          )}
          {task.notes && <KV label="ملاحظات" value={task.notes}/>}
          <KV label="منشأة" value={fmtRel(task.created_at)}/>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {onPromise && (
            <Btn size="md" variant="primary" icon={<Calendar size={13}/>} onClick={onPromise}>
              سجّل وعد دفع
            </Btn>
          )}
          {canUpdate && (
            <Btn size="md" variant="ghost" icon={<CheckCircle2 size={13}/>} onClick={async () => {
              await updateTaskStage(task.id, 'done');
              onClose(); onRefresh();
            }}>
              مكتملة
            </Btn>
          )}
          {onWriteoff && (
            <Btn size="md" variant="danger" icon={<Trash2 size={13}/>} onClick={onWriteoff}>
              اطلب شطب الدين
            </Btn>
          )}
          <Btn size="md" variant="ghost" icon={<Download size={13}/>}
               onClick={async () => {
                 try {
                   const { exportCustomerSOA } = await import('../lib/soaExport.js');
                   const r = await exportCustomerSOA(task.customer_name);
                   toast(`تم تصدير كشف الحساب · رصيد ${r.balance.toLocaleString('en-US')} ر.س`, 'success');
                 } catch (e) { toast(`فشل: ${e.message}`, 'error'); }
               }}>
            📋 كشف الحساب
          </Btn>
          <Btn size="md" variant="ghost" onClick={onClose}>إغلاق</Btn>
        </div>
      </div>
    </Modal>
  );
}

function KV({ label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12 }}>
      <span style={{ color: 'var(--muted)', minWidth: 120 }}>{label}</span>
      <span style={{ flex: 1, color: 'var(--text)' }}>{value}</span>
    </div>
  );
}

function PromiseDialog({ task, onCancel, onConfirm }) {
  const [amount, setAmount] = useState(task.debt_at_creation || '');
  const [date,   setDate]   = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [notes,  setNotes]  = useState('');
  return (
    <Modal title={`وعد دفع — ${task.customer_name}`} onClose={onCancel} width={460}>
      <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); onConfirm({ amount, date, notes }); }}
            style={{ padding: '4px 4px 0' }}>
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>
            المبلغ المتعهَّد به (ر.س)
          </span>
          <input type="number" step="0.01" min="0" autoFocus value={amount}
                 onChange={(e) => setAmount(e.target.value)}
                 style={inputStyle} name="promise_amount" data-form-type="other" data-lpignore="true"/>
        </label>
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>
            تاريخ السداد الموعود
          </span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle}
                 name="promise_date" data-form-type="other"/>
        </label>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>
            ملاحظات (اختيارية)
          </span>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
                    placeholder="مثال: تحويل بنكي يوم الخميس"
                    style={{ ...inputStyle, resize: 'vertical' }}
                    name="promise_notes" data-form-type="other"/>
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn size="md" variant="accent" icon={<CheckCircle2 size={13}/>} onClick={() => onConfirm({ amount, date, notes })}>
            سجّل الوعد
          </Btn>
          <Btn size="md" variant="ghost" onClick={onCancel}>إلغاء</Btn>
        </div>
      </form>
    </Modal>
  );
}

function SnoozeDialog({ task, onCancel, onConfirm }) {
  const [until, setUntil] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 3);
    return d.toISOString().slice(0, 10);
  });
  return (
    <Modal title={`تأجيل — ${task.customer_name}`} onClose={onCancel} width={420}>
      <div style={{ padding: '4px 4px 0' }}>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>
            تظهر المهمة مجدّداً في
          </span>
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} style={inputStyle}/>
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn size="md" variant="accent" icon={<Clock size={13}/>} onClick={() => onConfirm(until)}>
            أجّل
          </Btn>
          <Btn size="md" variant="ghost" onClick={onCancel}>إلغاء</Btn>
        </div>
      </div>
    </Modal>
  );
}

const inputStyle = {
  width: '100%', padding: '9px 12px', fontSize: 13,
  border: '1px solid var(--border)', borderRadius: 8,
  background: 'var(--surface)', color: 'var(--text)',
  fontFamily: 'var(--font-sans)', boxSizing: 'border-box',
};

function WriteoffRequestDialog({ task, onCancel, onConfirm }) {
  const [amount, setAmount] = useState(task.debt_at_creation || '');
  const [reason, setReason] = useState('');
  return (
    <Modal title={`طلب شطب دين — ${task.customer_name}`} onClose={onCancel} width={520}>
      <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); onConfirm({ amount, reason }); }}
            style={{ padding: '4px 4px 0' }}>
        <div style={{
          padding: 12, marginBottom: 12, borderRadius: 8,
          background: 'color-mix(in srgb, var(--red) 5%, transparent)',
          border: '1px solid color-mix(in srgb, var(--red) 22%, transparent)',
          fontSize: 12, color: 'var(--text2)', lineHeight: 1.7,
        }}>
          <AlertTriangle size={14} color="var(--red)" style={{ display: 'inline', marginInlineEnd: 5, verticalAlign: 'middle' }}/>
          الطلب سيُرسَل للمدير. بعد الاعتماد يُخصم المبلغ من رصيد العميل المعروض،
          مع إبقاء الكشف الأصلي كما هو للمراجعة الخارجية. كل التغييرات تُسجَّل في activity_log.
        </div>
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>
            المبلغ المطلوب شطبه (ر.س)
          </span>
          <input type="number" step="0.01" min="0.01" autoFocus value={amount}
                 onChange={(e) => setAmount(e.target.value)}
                 style={inputStyle}
                 name="writeoff_amount" data-form-type="other" data-lpignore="true"/>
        </label>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>
            السبب (مطلوب)
          </span>
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                    placeholder="مثال: العميل أعلن إفلاسه — قُدّم القانون 5 شهور بدون رد"
                    style={{ ...inputStyle, resize: 'vertical' }}
                    name="writeoff_reason" data-form-type="other"/>
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn size="md" variant="danger"
               icon={<Trash2 size={13}/>}
               onClick={() => onConfirm({ amount, reason })}
               disabled={!amount || !reason.trim()}>
            أرسل الطلب
          </Btn>
          <Btn size="md" variant="ghost" onClick={onCancel}>إلغاء</Btn>
        </div>
      </form>
    </Modal>
  );
}

function ReviewQueueModal({ pending, onClose, onApprove, onReject }) {
  const [actingOn, setActingOn] = useState(null);  // { id, kind: 'approve'|'reject' }
  const [note, setNote] = useState('');
  return (
    <Modal title={`طلبات شطب الدين بانتظار الموافقة — ${pending.length}`} onClose={onClose} width={780}>
      <div style={{ padding: '4px 4px 0' }}>
        {pending.length === 0 ? (
          <Empty icon="✓" title="لا توجد طلبات بانتظار الموافقة"/>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pending.map(w => (
              <Card key={w.id} style={{ padding: 14 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                      {w.customer_name}
                      <span style={{ marginInlineStart: 10, fontSize: 12, color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>
                        {fmt(w.amount)} ر.س
                      </span>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6, lineHeight: 1.6 }}>
                      <strong style={{ color: 'var(--text2)' }}>السبب:</strong> {w.reason}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted2)', marginTop: 4 }}>
                      طُلب {fmtRel(w.requested_at)}
                    </div>
                  </div>
                  {actingOn?.id === w.id ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 240 }}>
                      <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                                placeholder={actingOn.kind === 'reject' ? 'سبب الرفض (إلزامي)' : 'ملاحظة (اختيارية)'}
                                style={{ ...inputStyle, resize: 'vertical', fontSize: 11.5 }}/>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Btn size="sm" variant={actingOn.kind === 'approve' ? 'accent' : 'danger'}
                             onClick={async () => {
                               if (actingOn.kind === 'approve') {
                                 await onApprove(w.id, note);
                               } else {
                                 if (!note.trim()) return;
                                 await onReject(w.id, note);
                               }
                               setActingOn(null); setNote('');
                             }}
                             disabled={actingOn.kind === 'reject' && !note.trim()}>
                          أكّد
                        </Btn>
                        <Btn size="sm" variant="ghost" onClick={() => { setActingOn(null); setNote(''); }}>
                          إلغاء
                        </Btn>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Btn size="sm" variant="accent"
                           icon={<CheckCircle2 size={11}/>}
                           onClick={() => { setActingOn({ id: w.id, kind: 'approve' }); setNote(''); }}>
                        اعتماد
                      </Btn>
                      <Btn size="sm" variant="danger"
                           icon={<X size={11}/>}
                           onClick={() => { setActingOn({ id: w.id, kind: 'reject' }); setNote(''); }}>
                        رفض
                      </Btn>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
        <div style={{ marginTop: 14 }}>
          <Btn size="md" variant="ghost" onClick={onClose}>إغلاق</Btn>
        </div>
      </div>
    </Modal>
  );
}
