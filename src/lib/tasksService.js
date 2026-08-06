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
  cod_remittance: { label: 'تحصيل COD',  icon: '💰', color: 'var(--green)' },
  invoice:        { label: 'فاتورة',      icon: '🧾', color: 'var(--brand)' },
  statement:      { label: 'كشف حساب',    icon: '📑', color: 'var(--accent)' },
  weight_report:  { label: 'تقرير أوزان', icon: '⚖️', color: 'var(--gold)' },
};

export const CADENCE_META = {
  weekly:    { label: 'أسبوعي',      days: 7  },
  biweekly:  { label: 'كل أسبوعين',  days: 14 },
  monthly:   { label: 'شهري',        days: 30 },
  on_demand: { label: 'حسب الطلب',   days: null },
};

function daysInAccountingMonth(period) {
  const [year, month] = String(period || '').split('-').map(Number);
  if (!year || month < 1 || month > 12) throw new Error('الفترة يجب أن تكون بصيغة YYYY-MM');
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoDate(period, day) {
  return `${period}-${String(day).padStart(2, '0')}`;
}

// Turns the saved cadence into explicit expected delivery dates for a month.
// Historical rows use two weekly styles: 0..6 means a weekday, while 8+
// means fixed weekly month dates (8/15/22/29). Biweekly rows use the saved
// start day and a second date 15 days later (for example 5/20).
export function expectedScheduleSlots(schedule, period) {
  if (!schedule?.active || schedule.cadence === 'on_demand') return [];
  const daysInMonth = daysInAccountingMonth(period);
  const configured = Array.isArray(schedule.due_days)
    ? schedule.due_days.map(Number).filter(Number.isInteger)
    : [];
  const day = Number(schedule.day_of_period);
  let days = [];

  if (configured.length) {
    if (schedule.schedule_basis === 'weekday') {
      const weekdays = new Set(configured.filter(value => value >= 0 && value <= 6));
      const [year, month] = period.split('-').map(Number);
      for (let value = 1; value <= daysInMonth; value += 1) {
        if (weekdays.has(new Date(Date.UTC(year, month - 1, value)).getUTCDay())) days.push(value);
      }
    } else {
      days = configured.filter(value => value >= 1 && value <= daysInMonth);
    }
  } else if (schedule.cadence === 'weekly' && day >= 0 && day <= 6) {
    const [year, month] = period.split('-').map(Number);
    for (let value = 1; value <= daysInMonth; value += 1) {
      if (new Date(Date.UTC(year, month - 1, value)).getUTCDay() === day) days.push(value);
    }
  } else if (schedule.cadence === 'weekly' && day >= 1) {
    for (let value = day; value <= daysInMonth; value += 7) days.push(value);
  } else if (schedule.cadence === 'biweekly' && day >= 1) {
    days = [day, day + 15].filter(value => value <= daysInMonth);
  } else if (schedule.cadence === 'monthly') {
    days = [Math.min(Math.max(day || 1, 1), daysInMonth)];
  }

  return [...new Set(days)].sort((a, b) => a - b).map(value => ({
    key: `${schedule.id || `${schedule.carrier_id}:${schedule.task_kind}`}:${isoDate(period, value)}`,
    dueDate: isoDate(period, value),
    day: value,
  }));
}

export function scheduleRequirementLabel(schedule, period) {
  const slots = expectedScheduleSlots(schedule, period);
  if (!slots.length) return 'حسب الطلب';
  return `${CADENCE_META[schedule.cadence]?.label || schedule.cadence} · ${slots.map(slot => slot.day).join('، ')}`;
}

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
