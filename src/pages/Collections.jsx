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
import {
  RefreshCw, Phone, CheckCircle2, Clock, X, AlertTriangle, Download,
  Inbox, MessageSquare, Calendar, Sparkles, Edit3, Plus, ChevronLeft,
} from 'lucide-react';
import {
  Card, Btn, Spinner, Empty, Modal, toast, PageHeader,
} from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadLatestReceivables } from '../lib/customerReceivablesService.js';
import {
  TRIGGER_LABELS, STAGE_LABELS,
  listTasks, regenerateTasks, updateTaskStage, recordPromise,
  completePromise, breakPromise, snoozeTask, cancelTask, deleteTask,
} from '../lib/collectionsService.js';

const fmt = (n) =>
  n == null || Number.isNaN(n) ? '—'
  : Number(n).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCompact = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1_000) return (n / 1_000).toFixed(1) + 'ك';
  return n.toFixed(0);
};
const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('ar-SA', { dateStyle: 'medium' }); }
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
  promised:  '#F59E0B',
  done:      '#10B981',
  snoozed:   '#6B7280',
  cancelled: '#9CA3AF',
};
const TRIGGER_COLORS = {
  over_credit_limit:  '#B91C1C',
  aged_90:            '#DC2626',
  aged_60:            '#F97316',
  aged_30:            '#F59E0B',
  prepaid_with_debt:  '#EF4444',
  manual:             '#0EA5E9',
};

export default function Collections({ isActive = true }) {
  const location = useLocation();
  const { profile } = useAuth();
  const [loading, setLoading]   = useState(true);
  const [tasks, setTasks]       = useState([]);
  const [customers, setCustomers] = useState([]);  // for regenerate + lookup
  const [stageFilter, setStageFilter] = useState('open');  // open|all|<stage>
  const [drawer, setDrawer]     = useState(null);
  const [ptpOpen, setPtpOpen]   = useState(null);
  const [snoozeOpen, setSnoozeOpen] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [t, recs] = await Promise.all([
        listTasks({ includeDone: stageFilter !== 'open' }),
        loadLatestReceivables().catch(() => ({ activeCustomers: [] })),
      ]);
      setTasks(t);
      setCustomers(recs?.activeCustomers || recs?.customers || []);
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
    // Sort: snoozed-overdue first, then by debt desc, then by created
    return [...pool].sort((a, b) => {
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
    XLSX.writeFile(wb, `قائمة_التحصيل_${new Date().toISOString().slice(0, 10)}.xlsx`);
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
        <SummaryStat label="وعود فعّالة"     value={stats.promised}         color="#F59E0B"/>
        <SummaryStat label="وعود اليوم"      value={stats.promiseDueToday}  color="#10B981"/>
        <SummaryStat label="وعود متأخّرة"    value={stats.promiseOverdue}   color="#DC2626"/>
      </div>

      {/* Stage filter chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {['open', 'todo', 'contacted', 'promised', 'snoozed', 'done', 'cancelled', 'all'].map(s => (
          <button key={s} onClick={() => setStageFilter(s)} style={{
            padding: '6px 14px', borderRadius: 999, cursor: 'pointer',
            border: `1.5px solid ${stageFilter === s ? '#EF4444' : 'var(--border)'}`,
            background: stageFilter === s ? 'rgba(239,68,68,.12)' : 'transparent',
            color: stageFilter === s ? '#DC2626' : 'var(--text2)',
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
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
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
                    background: isOverdueSnooze || isPromiseOverdue ? 'color-mix(in srgb, #DC2626 4%, transparent)' : 'transparent',
                    cursor: 'pointer',
                  }} onClick={() => setDrawer(t)}>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text)' }}>
                      {t.customer_name}
                      {c?.merchant?.phone && (
                        <div style={{ fontSize: 10.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)', direction: 'ltr', textAlign: 'right', marginTop: 2 }}>
                          {c.merchant.phone}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={pill(TRIGGER_COLORS[t.trigger])}>
                        {TRIGGER_LABELS[t.trigger] || t.trigger}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={pill(STAGE_COLORS[t.stage])}>
                        {STAGE_LABELS[t.stage] || t.stage}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#DC2626' }}>
                      {fmtCompact(t.debt_at_creation)}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 11, color: 'var(--muted)' }}>
                      {t.days_outstanding != null ? `${t.days_outstanding} يوم` : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 11 }}>
                      {t.stage === 'promised' ? (
                        <span style={{ color: isPromiseOverdue ? '#DC2626' : '#F59E0B', fontWeight: 600 }}>
                          {fmtCompact(t.promise_amount)} يوم {fmtDate(t.promise_date)}
                          {isPromiseOverdue && ' ⚠'}
                        </span>
                      ) : t.stage === 'snoozed' ? (
                        <span style={{ color: isOverdueSnooze ? '#DC2626' : 'var(--muted)' }}>
                          مؤجّلة حتى {fmtDate(t.snooze_until)}
                          {isOverdueSnooze && ' ⚠'}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ padding: '10px 12px' }} onClick={(e) => e.stopPropagation()}>
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
        {value.toLocaleString('ar-SA')}
      </div>
    </Card>
  );
}

function QuickActions({ task, onContact, onPromise, onDone, onSnooze, onCancel }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {task.stage === 'todo' && (
        <ActionBtn title="تواصلت" icon={<MessageSquare size={11}/>} color="#8B5CF6" onClick={onContact}/>
      )}
      {(task.stage === 'todo' || task.stage === 'contacted') && (
        <ActionBtn title="وعد دفع" icon={<Calendar size={11}/>} color="#F59E0B" onClick={onPromise}/>
      )}
      <ActionBtn title="مكتملة" icon={<CheckCircle2 size={11}/>} color="#10B981" onClick={onDone}/>
      <ActionBtn title="أجّل" icon={<Clock size={11}/>} color="#6B7280" onClick={onSnooze}/>
      <ActionBtn title="ألغ" icon={<X size={11}/>} color="#DC2626" onClick={onCancel}/>
    </div>
  );
}

function ActionBtn({ title, icon, color, onClick }) {
  return (
    <button onClick={onClick} title={title} style={{
      width: 26, height: 26, borderRadius: 6, cursor: 'pointer',
      border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      background: `color-mix(in srgb, ${color} 8%, transparent)`,
      color, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 0,
    }}
    onMouseEnter={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${color} 18%, transparent)`; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${color} 8%, transparent)`; }}
    >
      {icon}
    </button>
  );
}

function TaskDrawer({ task, customer, onClose, onRefresh, onPromise }) {
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
          <Btn size="md" variant="primary" icon={<CheckCircle2 size={13}/>} onClick={() => onConfirm({ amount, date, notes })}>
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
          <Btn size="md" variant="primary" icon={<Clock size={13}/>} onClick={() => onConfirm(until)}>
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
