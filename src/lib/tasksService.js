// Recurring task scheduler service.
//
// Tracks per-carrier expected cadences for receiving COD remittances,
// invoices, statements, and weight reports. The "due this week"
// surface is derived in JS from last_completed_at + cadence — no
// cron, no scheduled jobs. The operator marks a task done after
// they upload/process the corresponding file.
//
// API:
//   listSchedules()                            → every active row
//   upsertSchedule({ carrierId, taskKind, cadence, dayOfPeriod, notes })
//   markTaskDone(scheduleId, userId)
//   deleteSchedule(id)
//   deriveDueState(schedule, now)              → { dueAt, isDue, isOverdue, daysUntilDue }
//
// The cadence semantics:
//   weekly    — once per 7 days (or on dayOfPeriod = 0..6, Sun..Sat)
//   biweekly  — once per 14 days
//   monthly   — once per ~30 days (or on dayOfPeriod = 1..28)
//   on_demand — no fixed cadence; never marked "due" by the system

import { supabase } from './supabase.js';

const DAY_MS = 86_400_000;

export const TASK_KIND_META = {
  cod_remittance: { label: 'تحصيل COD',  icon: '💰', color: '#10B981' },
  invoice:        { label: 'فاتورة',      icon: '🧾', color: '#3B82F6' },
  statement:      { label: 'كشف حساب',    icon: '📑', color: '#8B5CF6' },
  weight_report:  { label: 'تقرير أوزان', icon: '⚖️', color: '#F59E0B' },
};

export const CADENCE_META = {
  weekly:    { label: 'أسبوعي',      days: 7  },
  biweekly:  { label: 'كل أسبوعين',  days: 14 },
  monthly:   { label: 'شهري',        days: 30 },
  on_demand: { label: 'حسب الطلب',   days: null },
};

export async function listSchedules({ activeOnly = true } = {}) {
  let q = supabase
    .from('carrier_task_schedules')
    .select('*')
    .order('carrier_id')
    .order('task_kind');
  if (activeOnly) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function upsertSchedule({
  id = null, carrierId, taskKind, cadence,
  dayOfPeriod = null, notes = null, active = true,
}) {
  if (!carrierId || !taskKind || !cadence) {
    throw new Error('carrier_id و task_kind و cadence مطلوبة');
  }
  const row = {
    carrier_id:    carrierId,
    task_kind:     taskKind,
    cadence,
    day_of_period: dayOfPeriod,
    notes:         notes?.trim() || null,
    active,
    updated_at:    new Date().toISOString(),
  };
  if (id) row.id = id;
  const { data, error } = await supabase
    .from('carrier_task_schedules')
    .upsert(row, { onConflict: 'carrier_id,task_kind' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function markTaskDone(scheduleId, userId = null) {
  if (!scheduleId) throw new Error('scheduleId مطلوب');
  const { data, error } = await supabase
    .from('carrier_task_schedules')
    .update({
      last_completed_at: new Date().toISOString(),
      last_completed_by: userId,
      updated_at:        new Date().toISOString(),
    })
    .eq('id', scheduleId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteSchedule(id) {
  if (!id) throw new Error('id مطلوب');
  const { error, data } = await supabase
    .from('carrier_task_schedules')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('لم يتم الحذف');
  return { ok: true };
}

// Compute due-state for one schedule. The week here is the calendar
// week starting from "now" — used by the UI to bucket tasks into
// "overdue", "due-this-week", and "later".
export function deriveDueState(schedule, now = new Date()) {
  const cadence = CADENCE_META[schedule.cadence];
  if (!cadence || cadence.days == null) {
    return { dueAt: null, isDue: false, isOverdue: false, daysUntilDue: null, label: 'حسب الطلب' };
  }
  const lastDone = schedule.last_completed_at ? new Date(schedule.last_completed_at) : null;
  // If never completed, baseline = created_at (or "now" minus cadence
  // so it shows up as immediately due).
  const baseline = lastDone || new Date(schedule.created_at) || new Date(now.getTime() - cadence.days * DAY_MS);
  const dueAt = new Date(baseline.getTime() + cadence.days * DAY_MS);
  const diffMs = dueAt.getTime() - now.getTime();
  const daysUntilDue = Math.ceil(diffMs / DAY_MS);
  const isOverdue = diffMs < 0;
  const isDueThisWeek = daysUntilDue >= 0 && daysUntilDue <= 7;
  return {
    dueAt,
    isDue: isOverdue || isDueThisWeek,
    isOverdue,
    daysUntilDue,
    label: isOverdue
      ? `متأخّر ${Math.abs(daysUntilDue)} يوم`
      : daysUntilDue === 0
        ? 'مستحق اليوم'
        : daysUntilDue === 1
          ? 'مستحق غداً'
          : `بعد ${daysUntilDue} يوم`,
  };
}

// Bulk derive — returns the active set partitioned into:
//   overdue, dueThisWeek, later, onDemand
export function partitionByDueness(schedules, now = new Date()) {
  const groups = { overdue: [], dueThisWeek: [], later: [], onDemand: [] };
  for (const s of schedules) {
    if (!s.active) continue;
    const state = deriveDueState(s, now);
    const withState = { ...s, _state: state };
    if (state.dueAt == null)         groups.onDemand.push(withState);
    else if (state.isOverdue)        groups.overdue.push(withState);
    else if (state.daysUntilDue <= 7) groups.dueThisWeek.push(withState);
    else                              groups.later.push(withState);
  }
  // Sort each bucket by urgency
  groups.overdue.sort((a, b) => a._state.daysUntilDue - b._state.daysUntilDue);
  groups.dueThisWeek.sort((a, b) => a._state.daysUntilDue - b._state.daysUntilDue);
  groups.later.sort((a, b) => a._state.daysUntilDue - b._state.daysUntilDue);
  return groups;
}
