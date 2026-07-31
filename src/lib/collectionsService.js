// Collections workflow service.
//
// Operator-facing queue of customer-debt tasks. Each task is one
// (customer × trigger) pair the system thinks deserves attention:
// over the credit limit, aged 30/60/90, prepaid-with-debt, or
// manually created. The unique partial index on the DB enforces
// "one open task per pair" so re-running auto-generation doesn't
// duplicate.
//
// Lifecycle:
//   todo        → contacted → promised → done
//                                     ↘  broken → escalate (back to contacted)
//        ↘ snoozed (auto re-emerges)
//        ↘ cancelled (operator says "not real")
//
// Public API:
//   listTasks({ stage, customer })          → task rows
//   regenerateTasks({ customers })          → creates new tasks for
//     customers that meet criteria but don't already have an open
//     task. Returns counts per trigger.
//   updateTaskStage(id, stage, fields)      → moves through lifecycle
//   recordPromise(id, { amount, date, notes }) → stage='promised'
//   completePromise(id, { honoredAmount })  → stage='done'
//   breakPromise(id)                        → promise_status='broken'
//   snoozeTask(id, untilDate)               → stage='snoozed'
//   createManualTask({ customer, debt, notes }) → for one-offs

import { supabase } from './supabase.js';

const TRIGGER_LABELS = {
  over_credit_limit:  '🛑 تجاوز السقف',
  aged_30:            '🟡 متأخّر 30 يوم',
  aged_60:            '🟠 متأخّر 60 يوم',
  aged_90:            '🔴 متأخّر 90 يوم',
  prepaid_with_debt:  '🚨 دفع مسبق وعليه دين',
  manual:             '✍ يدوي',
};
const STAGE_LABELS = {
  todo:       'جديدة',
  contacted:  'تواصلت',
  promised:   'وعد دفع',
  done:       'مكتملة',
  snoozed:    'مؤجّلة',
  cancelled:  'ملغاة',
};
export { TRIGGER_LABELS, STAGE_LABELS };

export async function listTasks({ stage = null, customer = null, includeDone = false } = {}) {
  let q = supabase.from('collection_tasks').select('*').order('created_at', { ascending: false });
  if (stage)      q = q.eq('stage', stage);
  if (customer)   q = q.eq('customer_name', customer);
  if (!includeDone && !stage) {
    q = q.in('stage', ['todo','contacted','promised','snoozed']);
  }
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// Auto-generate tasks from the customer list (already enriched with
// total/daysOutstanding/overLimit/creditLimit by
// loadLatestReceivables). Skips customers that already have an open
// task with the same trigger thanks to the partial unique index —
// the upsert returns ON CONFLICT DO NOTHING silently.
const OPEN_STAGES = ['todo', 'contacted', 'promised', 'snoozed'];

export async function reconcileStaleOpenTasks({ customers = [], userId = null } = {}) {
  if (!Array.isArray(customers) || customers.length === 0) return { closed: 0, customers: [] };
  const liveNames = new Set(
    (customers || [])
      .filter(c => (Number(c.total) || 0) > 0.5)
      .map(c => c.name)
      .filter(Boolean),
  );

  const { data, error } = await supabase
    .from('collection_tasks')
    .select('id, customer_name, trigger, stage, notes')
    .in('stage', OPEN_STAGES);
  if (error) throw error;

  const stale = (data || []).filter(t =>
    t.trigger !== 'manual' &&
    !liveNames.has(t.customer_name),
  );
  if (!stale.length) return { closed: 0, customers: [] };

  const now = new Date().toISOString();
  const reason = 'أُغلقت تلقائياً: لا يوجد رصيد مفتوح في زوهو';
  let closed = 0;

  for (const task of stale) {
    const notes = task.notes ? `${task.notes} · ${reason}` : reason;
    const { error: updateError } = await supabase
      .from('collection_tasks')
      .update({
        stage: 'done',
        done_at: now,
        done_by: userId,
        notes,
        updated_at: now,
      })
      .eq('id', task.id);
    if (!updateError) closed++;
  }

  return { closed, customers: stale.map(t => t.customer_name) };
}

export async function regenerateTasks({ customers, userId = null }) {
  // المصدر والحسم والتوزيع أصبحت ذرية في القاعدة. إبقاء الوسيط هنا يحافظ
  // على عقد الاستدعاء القديم للصفحة من دون كتابة عشرات الصفوف من المتصفح.
  void customers;
  void userId;
  const { data, error } = await supabase.rpc('refresh_collection_tasks');
  if (error) throw error;
  return {
    created: Number(data?.created) || 0,
    closed: Number(data?.closed) || 0,
    cancelled: Number(data?.cancelled) || 0,
    reassigned: Number(data?.reassigned) || 0,
    promisesChecked: Number(data?.promises?.checked) || 0,
  };
}

export async function updateTaskStage(id, stage, patch = {}) {
  if (!id || !stage) throw new Error('id + stage مطلوبان');
  const row = {
    stage,
    updated_at: new Date().toISOString(),
    ...patch,
  };
  if (stage === 'done')      { row.done_at = new Date().toISOString(); row.done_by = patch.userId || null; delete row.userId; }
  if (stage !== 'snoozed')   row.snooze_until = null;
  const { data, error } = await supabase
    .from('collection_tasks').update(row).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function recordPromise(id, { amount, date, notes }) {
  if (!amount || !date) throw new Error('مبلغ وتاريخ مطلوبان');
  const { data, error } = await supabase.rpc('collection_record_promise', {
    p_task_id: id,
    p_amount: Number(amount),
    p_date: date,
    p_notes: notes?.trim() || null,
  });
  if (error) throw error;
  return data;
}

export async function completePromise(id, { honoredAmount, userId = null }) {
  return updateTaskStage(id, 'done', {
    promise_status:  'honored',
    honored_amount:  honoredAmount != null ? Number(honoredAmount) : null,
    userId,
  });
}

export async function breakPromise(id) {
  return updateTaskStage(id, 'contacted', {
    promise_status: 'broken',
  });
}

export async function snoozeTask(id, untilDate) {
  if (!untilDate) throw new Error('تاريخ التأجيل مطلوب');
  return updateTaskStage(id, 'snoozed', {
    snooze_until: new Date(untilDate).toISOString(),
  });
}

export async function cancelTask(id, reason) {
  return updateTaskStage(id, 'cancelled', { notes: reason || null });
}

export async function createManualTask({ customerName, debt, notes, userId = null }) {
  if (!customerName) throw new Error('اسم العميل مطلوب');
  const { data, error } = await supabase
    .from('collection_tasks')
    .insert({
      customer_name:    customerName,
      trigger:          'manual',
      stage:            'todo',
      debt_at_creation: Number(debt) || 0,
      notes:            notes?.trim() || null,
      assigned_to:      userId,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTask(id) {
  if (!id) throw new Error('id مطلوب');
  const { error } = await supabase.from('collection_tasks').delete().eq('id', id);
  if (error) throw error;
  return { ok: true };
}

// ── قائمة الإيقاف الائتماني (دين زوهو الحيّ) ──────────────────────────────
// قاعدة الحقيقة الواحدة لإشارة «تجاوز الحدّ» — عملاء دفع-لاحق (لهم فواتير زوهو
// مفتوحة) تجاوزوا الحدّ (افتراضياً 10,000 ر.س) أو لهم فاتورة تجاوزت 30 يوماً.
// المصدر = دين زوهو الحيّ (§1.24) عبر RPC credit_stop_list — لا snapshot داخلي
// (بخلاف regenerateTasks أعلاه الذي يقرأ الكشف الداخلي). «نشط» = ما زال يشحن،
// فإيقافه يمنع تراكم الدين. تُستهلَك في بطاقة /decisions + شاشة التحصيل.
export async function loadCreditStopList({ limit = 10000, overdueDays = 30 } = {}) {
  const { data, error } = await supabase.rpc('credit_stop_list', { p_limit: limit, p_overdue: overdueDays });
  if (error) throw error;
  const d = data || {};
  const s = d.summary || {};
  return {
    limit: Number(d.limit) || limit,
    overdueDays: Number(d.overdue_days) || overdueDays,
    count: Number(s.count) || 0,
    total: Number(s.total) || 0,
    activeCount: Number(s.active_count) || 0,
    activeTotal: Number(s.active_total) || 0,
    rows: (Array.isArray(d.rows) ? d.rows : []).map(r => ({
      customerName: r.customer_name, storeName: r.store_name || '', storeId: r.store_id || null,
      phone: r.phone || '', billingType: r.billing_type || '', status: r.status || '',
      active: !!r.active,
      totalOpen: Number(r.total_open) || 0, overdueAmount: Number(r.overdue_amount) || 0,
      oldestDays: Number(r.oldest_days) || 0, invCnt: Number(r.inv_cnt) || 0,
      reason: r.reason || '',
    })),
  };
}

// تسمية سبب تجاوز الحدّ بالعربي (للبطاقات والجداول).
export function stopReasonAr(reason) {
  if (reason === 'both') return 'فوق الحدّ +متأخّر';
  if (reason === 'over_limit') return 'فوق الحدّ';
  if (reason === 'overdue') return '+30 يوم';
  return '';
}

// ── مستويات التصعيد (dunning) حسب عمر أقدم فاتورة ─────────────────────────────
// التصعيد بالأولوية والإيقاع لا بنصوص مختلفة (القالب المعتمد في واتساب واحد).
// قاعدة المستخدم: متأخّر = تجاوز 30 يوم. الحدود تراكمية (≤ max).
export const DUNNING_LEVELS = [
  { key: 'current', label: 'جارٍ',         color: 'var(--muted)', max: 30 },
  { key: 'remind',  label: 'تذكير',        color: 'var(--gold)',  max: 45 },
  { key: 'firm',    label: 'حازم',         color: '#F97316',      max: 60 },
  { key: 'urgent',  label: 'تحذير إيقاف',  color: 'var(--red)',   max: 90 },
  { key: 'legal',   label: 'تصعيد قانوني', color: '#B91C1C',      max: Infinity },
];
export function dunningLevel(days) {
  const d = Number(days) || 0;
  return DUNNING_LEVELS.find(l => d <= l.max) || DUNNING_LEVELS[DUNNING_LEVELS.length - 1];
}

// ── حركة أعمار الذمم شهر-بشهر (roll-rate) ───────────────────────────────────
// يلتقط لقطة الشهر الجاري (upsert، يبني التاريخ عضوياً بلا كرون) ثم يقرأ آخر
// الشهور. roll-rate الحقيقي يحتاج ≥2 شهر — قبلها الواجهة تعرض «قيد التجميع».
export async function loadAgingTrend() {
  // supabase.rpc() builder لا يملك .catch — نلفّه بـ try (الالتقاط غير قاتل)
  try { await supabase.rpc('capture_ar_aging_snapshot'); } catch { /* غير قاتل */ }
  const { data, error } = await supabase.rpc('ar_aging_trend', { p_months: 6 });
  if (error) throw error;
  const rows = (Array.isArray(data) ? data : []).map(r => ({
    period: r.period,
    b0_30: Number(r.b0_30) || 0, b31_60: Number(r.b31_60) || 0,
    b61_90: Number(r.b61_90) || 0, b90p: Number(r.b90p) || 0, total: Number(r.total) || 0,
  }));
  const n = rows.length;
  return { rows, cur: n ? rows[n - 1] : null, prev: n >= 2 ? rows[n - 2] : null, hasHistory: n >= 2 };
}

// ── مرشّحو التحصيل من دين زوهو الحيّ (توحيد طابور التحصيل) ────────────────────
// يُغذّي regenerateTasks بنفس مصدر بطاقة الإيقاف (RPC customer_money_dashboard =
// فواتير زوهو المفتوحة §1.24) بدل الكشف الداخلي (snapshot) — فطابور /crm?tab=
// collections يعكس نفس أرقام /decisions و/customer-money (رقم واحد لكل مفهوم).
// الشكل يطابق ما يتوقّعه regenerateTasks: name/total/daysOutstanding/overLimit/
// creditLimit/merchant.billingType. الحدّ الافتراضي 10,000 (قاعدة المستخدم).
export async function loadCollectionCandidates({ creditLimit = 10000 } = {}) {
  const { data, error } = await supabase.rpc('customer_money_dashboard');
  if (error) throw error;
  const rows = Array.isArray(data?.customers) ? data.customers : [];
  return rows.map(c => {
    const total = Number(c.owed) || 0;
    return {
      name: c.name,
      total,
      overdue: Number(c.overdue) || 0,
      daysOutstanding: Number(c.oldest_days) || 0,
      overLimit: total > creditLimit,
      creditLimit,
      phone: c.phone || '',
      merchant: {
        billingType: c.billing_type || '',
        storeName: c.store_name || '',
        phone: c.phone || '',
        walletBalance: Number(c.wallet_balance) || 0,
        platformStatus: c.platform_status || '',
      },
    };
  });
}
