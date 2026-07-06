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
import { useLocation } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { rtl } from '../lib/xlsxRtl.js';
import {
  RefreshCw, Phone, CheckCircle2, Clock, X, AlertTriangle, Download,
  Inbox, MessageSquare, Calendar, Sparkles, Edit3, Plus, ChevronLeft, Trash2,
} from 'lucide-react';
import {
  Card, Btn, Spinner, Empty, Modal, toast, PageHeader,
} from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  TRIGGER_LABELS, STAGE_LABELS,
  listTasks, regenerateTasks, updateTaskStage, recordPromise,
  completePromise, breakPromise, snoozeTask, cancelTask, deleteTask,
  loadCollectionCandidates,
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
  todo:      '#0EA5E9',
  contacted: '#8B5CF6',
  promised:  'var(--gold)',
  done:      'var(--green)',
  snoozed:   '#6B7280',
  cancelled: '#9CA3AF',
};
const TRIGGER_COLORS = {
  over_credit_limit:  '#B91C1C',
  aged_90:            'var(--red)',
  aged_60:            '#F97316',
  aged_30:            'var(--gold)',
  prepaid_with_debt:  '#EF4444',
  manual:             '#0EA5E9',
};

export default function Collections({ isActive = true }) {
  const location = useLocation();
  const { profile, can } = useAuth();
  const canApproveWriteoff = can('receivables.approve_writeoff');
  const [loading, setLoading]   = useState(true);
  const [tasks, setTasks]       = useState([]);
  const [customers, setCustomers] = useState([]);  // for regenerate + lookup
  const [stageFilter, setStageFilter] = useState('open');  // open|all|<stage>
  const [drawer, setDrawer]     = useState(null);
  const [ptpOpen, setPtpOpen]   = useState(null);
  const [snoozeOpen, setSnoozeOpen] = useState(null);
  const [writeoffOpen, setWriteoffOpen] = useState(null);   // task being written off
  const [pendingWriteoffs, setPendingWriteoffs] = useState([]);
  const [reviewQueueOpen, setReviewQueueOpen]   = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [t, recs, pending] = await Promise.all([
        listTasks({ includeDone: stageFilter !== 'open' }),
        loadCollectionCandidates().catch(() => []),   // دين زوهو الحيّ (كان snapshot)
        listWriteoffs({ status: 'pending' }).catch(() => []),
      ]);
      setTasks(t);
      setCustomers(recs || []);
      setPendingWriteoffs(pending);
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setLoading(false);
  }, [stageFilter]);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh, location.pathname]);

  const customerByName = useMemo(
    () => new Map(customers.map(c => [c.name, c])),
    [customers],
  );

  const handleRegenerate = async () => {
    try {
      const r = await regenerateTasks({ customers, userId: profile?.id || null });
      if (r.created > 0) {
        toast(`✓ تم إضافة ${r.created} مهمة جديدة`, 'success');
      } else {
        toast('لا توجد مهام جديدة — كل الحالات مغطّاة', 'info');
      }
      await refresh();
    } catch (e) { toast(`فشل: ${e.message}`, 'error'); }
  };

  // Filter + sort tasks for the visible table.
  const visibleTasks = useMemo(() => {
    let pool = tasks;
    if (stageFilter === 'open') {
      pool = pool.filter(t => ['todo','contacted','promised','snoozed'].includes(t.stage));
    } else if (stageFilter !== 'all') {
      pool = pool.filter(t => t.stage === stageFilter);
    }
    // حاجز احتياطي: مهمة واحدة لكل عميل (الأكثر تقدّماً) — يمنع أي تكرار
    // متبقٍ من بيانات قديمة قبل إصلاح regenerateTasks.
    const rank = { promised: 4, contacted: 3, snoozed: 2, todo: 1 };
    const byCustomer = new Map();
    for (const t of pool) {
      const cur = byCustomer.get(t.customer_name);
      if (!cur || (rank[t.stage] || 0) > (rank[cur.stage] || 0)) byCustomer.set(t.customer_name, t);
    }
    const deduped = [...byCustomer.values()];
    // Sort: snoozed-overdue first, then by debt desc, then by created
    return deduped.sort((a, b) => {
      const aOverdueSnooze = a.stage === 'snoozed' && a.snooze_until && new Date(a.snooze_until) < new Date();
      const bOverdueSnooze = b.stage === 'snoozed' && b.snooze_until && new Date(b.snooze_until) < new Date();
      if (aOverdueSnooze !== bOverdueSnooze) return aOverdueSnooze ? -1 : 1;
      return (b.debt_at_creation || 0) - (a.debt_at_creation || 0);
    });
  }, [tasks, stageFilter]);

  const stats = useMemo(() => {
    const open    = tasks.filter(t => ['todo','contacted','promised','snoozed'].includes(t.stage));
    const promised = tasks.filter(t => t.stage === 'promised');
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
      totalDebt: +open.reduce((s, t) => s + (Number(t.debt_at_creation) || 0), 0).toFixed(2),
    };
  }, [tasks]);

  const exportTasks = () => {
    if (!visibleTasks.length) { toast('لا توجد مهام', 'info'); return; }
    const headers = [
      'العميل', 'المسبّب', 'المرحلة', 'الدين عند الإنشاء',
      'الأيام منذ آخر فاتورة', 'وعد بالدفع', 'تاريخ الوعد',
      'منشأة في', 'الملاحظات',
    ];
    const rows = visibleTasks.map(t => [
      t.customer_name,
      TRIGGER_LABELS[t.trigger] || t.trigger,
      STAGE_LABELS[t.stage] || t.stage,
      t.debt_at_creation,
      t.days_outstanding,
      t.promise_amount || '',
      t.promise_date || '',
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
    <div style={{ padding: '20px 24px 60px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader
        icon={<Phone size={22}/>}
        iconColor="#EF4444"
        title="قائمة التحصيل"
        subtitle="مهام مولّدة تلقائياً من العملاء اللي تجاوزوا السقف أو تأخّروا"
        meta={`${stats.open} مهمة مفتوحة · ${fmt(stats.totalDebt)} ر.س مفتوح`}
        actions={
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn size="sm" variant="primary" icon={<Sparkles size={13}/>} onClick={handleRegenerate}>
              توليد مهام جديدة
            </Btn>
            <Btn size="sm" variant="ghost" icon={<Download size={13}/>} onClick={exportTasks} disabled={!visibleTasks.length}>
              تصدير
            </Btn>
            <Btn size="sm" variant="ghost" icon={<RefreshCw size={13}/>} onClick={refresh}>
              تحديث
            </Btn>
          </div>
        }
      />

      {/* Stats strip */}
      <div style={{
        display: 'grid', gap: 12, marginBottom: 16,
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      }}>
        <SummaryStat label="مفتوحة"        value={stats.open}             color="#0EA5E9"/>
        <SummaryStat label="جديدة"          value={stats.todo}             color="#0EA5E9"/>
        <SummaryStat label="بانتظار الردّ"   value={stats.contacted}        color="#8B5CF6"/>
        <SummaryStat label="وعود فعّالة"     value={stats.promised}         color="var(--gold)"/>
        <SummaryStat label="وعود اليوم"      value={stats.promiseDueToday}  color="var(--green)"/>
        <SummaryStat label="وعود متأخّرة"    value={stats.promiseOverdue}   color="var(--red)"/>
      </div>

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
            {s === 'open' ? 'كل المفتوحة' : s === 'all' ? 'الكل' : STAGE_LABELS[s] || s}
          </button>
        ))}
      </div>

      {/* Tasks table */}
      {visibleTasks.length === 0 ? (
        <Empty
          icon="✓"
          title="لا توجد مهام في هذا التبويب"
          sub="اضغط 'توليد مهام جديدة' لإنشاء مهام من آخر كشف مديونيات"
        />
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <table className="m-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                {['العميل', 'المسبّب', 'المرحلة', 'الدين', 'عمر الدين', 'الوعد', 'إجراء'].map(h => (
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
                    <td data-label="" style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text)' }}>
                      {t.customer_name}
                      {c?.merchant?.phone && (
                        <div style={{ fontSize: 10.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)', direction: 'ltr', textAlign: 'right', marginTop: 2 }}>
                          {c.merchant.phone}
                        </div>
                      )}
                    </td>
                    <td data-label="المسبّب" style={{ padding: '10px 12px' }}>
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
                      {fmtCompact(t.debt_at_creation)}
                    </td>
                    <td data-label="عمر الدين" style={{ padding: '10px 12px', fontSize: 11, color: 'var(--muted)' }}>
                      {t.days_outstanding != null ? `${t.days_outstanding} يوم` : '—'}
                    </td>
                    <td data-label="الوعد" style={{ padding: '10px 12px', fontSize: 11 }}>
                      {t.stage === 'promised' ? (
                        <span style={{ color: isPromiseOverdue ? 'var(--red)' : 'var(--gold)', fontWeight: 600 }}>
                          {fmtCompact(t.promise_amount)} يوم {fmtDate(t.promise_date)}
                          {isPromiseOverdue && ' ⚠'}
                        </span>
                      ) : t.stage === 'snoozed' ? (
                        <span style={{ color: isOverdueSnooze ? 'var(--red)' : 'var(--muted)' }}>
                          مؤجّلة حتى {fmtDate(t.snooze_until)}
                          {isOverdueSnooze && ' ⚠'}
                        </span>
                      ) : '—'}
                    </td>
                    <td data-label="إجراء" style={{ padding: '10px 12px' }} onClick={(e) => e.stopPropagation()}>
                      <QuickActions task={t}
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
          onPromise={() => { setPtpOpen(drawer); setDrawer(null); }}
          onWriteoff={() => { setWriteoffOpen(drawer); setDrawer(null); }}
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
    <Card style={{
      padding: 12,
      background: `color-mix(in srgb, ${color} 4%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 18%, transparent)`,
    }}>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 600, letterSpacing: .3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: 'var(--font-mono)', letterSpacing: -0.4 }}>
        {value.toLocaleString('en-US')}
      </div>
    </Card>
  );
}

function QuickActions({ task, onContact, onPromise, onDone, onSnooze, onCancel }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {task.stage === 'todo' && (
        <Btn size="sm" variant="ghost" title="تواصلت" icon={<MessageSquare size={11}/>} onClick={onContact}/>
      )}
      {(task.stage === 'todo' || task.stage === 'contacted') && (
        <Btn size="sm" variant="ghost" title="وعد دفع" icon={<Calendar size={11}/>} onClick={onPromise}/>
      )}
      <Btn size="sm" variant="ghost" title="مكتملة" icon={<CheckCircle2 size={11}/>} onClick={onDone}/>
      <Btn size="sm" variant="ghost" title="أجّل" icon={<Clock size={11}/>} onClick={onSnooze}/>
      <Btn size="sm" variant="danger" title="ألغ" icon={<X size={11}/>} onClick={onCancel}/>
    </div>
  );
}

function TaskDrawer({ task, customer, onClose, onRefresh, onPromise, onWriteoff }) {
  return (
    <Modal title={`مهمة تحصيل — ${task.customer_name}`} onClose={onClose} width={560}>
      <div style={{ padding: '4px 4px 0' }}>
        <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
          <KV label="المسبّب" value={
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
          {task.notes && <KV label="ملاحظات" value={task.notes}/>}
          <KV label="منشأة" value={fmtRel(task.created_at)}/>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn size="md" variant="primary" icon={<Calendar size={13}/>} onClick={onPromise}>
            سجّل وعد دفع
          </Btn>
          <Btn size="md" variant="ghost" icon={<CheckCircle2 size={13}/>} onClick={async () => {
            await updateTaskStage(task.id, 'done');
            onClose(); onRefresh();
          }}>
            مكتملة
          </Btn>
          <Btn size="md" variant="danger" icon={<Trash2 size={13}/>} onClick={onWriteoff}>
            اطلب شطب الدين
          </Btn>
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
          مع إبقاء أصل الـ snapshot كما هو للمراجعة الخارجية. كل التغييرات تُسجَّل في activity_log.
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
