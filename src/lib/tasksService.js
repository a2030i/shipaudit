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
// The cadence semantics use explicit contractual calendar slots:
//   weekly    — weekday(s) or explicit month dates in due_days
//   biweekly  — two explicit month dates
//   monthly   — one explicit month date
//   on_demand — no fixed slot; never marked "due" by the system

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

export const WEEKDAY_META = [
  { value: 0, label: 'الأحد' },
  { value: 1, label: 'الاثنين' },
  { value: 2, label: 'الثلاثاء' },
  { value: 3, label: 'الأربعاء' },
  { value: 4, label: 'الخميس' },
  { value: 5, label: 'الجمعة' },
  { value: 6, label: 'السبت' },
];

export function parseScheduleDays(value) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(/[\s,،]+/);
  return [...new Set(raw
    .map(Number)
    .filter(Number.isInteger))]
    .sort((a, b) => a - b);
}

export function legacyScheduleDays(schedule = {}) {
  const saved = parseScheduleDays(schedule.due_days || []);
  if (saved.length) return saved;
  const day = schedule.day_of_period == null || schedule.day_of_period === ''
    ? Number.NaN
    : Number(schedule.day_of_period);
  if (!Number.isInteger(day)) return [];
  if (schedule.cadence === 'weekly' && day >= 7) {
    const days = [];
    for (let value = day; value <= 31; value += 7) days.push(value);
    return days;
  }
  if (schedule.cadence === 'biweekly' && day >= 1) return [day, day + 15].filter(value => value <= 31);
  return [day];
}

export function normalizeScheduleTiming({ cadence, scheduleBasis, dueDays, dayOfPeriod } = {}) {
  if (cadence === 'on_demand') {
    return { scheduleBasis: 'month_days', dueDays: [], dayOfPeriod: null };
  }
  const basis = cadence === 'weekly' && scheduleBasis === 'weekday' ? 'weekday' : 'month_days';
  const days = parseScheduleDays(dueDays?.length ? dueDays : (dayOfPeriod == null ? [] : [dayOfPeriod]));
  if (!days.length) throw new Error('حدد موعد الاستلام بوضوح');
  const min = basis === 'weekday' ? 0 : 1;
  const max = basis === 'weekday' ? 6 : 31;
  if (days.some(day => day < min || day > max)) {
    throw new Error(basis === 'weekday'
      ? 'يوم الأسبوع يجب أن يكون بين الأحد والسبت'
      : 'تواريخ الشهر يجب أن تكون بين 1 و31');
  }
  if (basis === 'weekday' && cadence !== 'weekly') {
    throw new Error('جدولة يوم الأسبوع متاحة للتكرار الأسبوعي فقط');
  }
  if (cadence === 'monthly' && days.length !== 1) {
    throw new Error('الفاتورة الشهرية تحتاج يوم استلام واحدًا');
  }
  return { scheduleBasis: basis, dueDays: days, dayOfPeriod: days[0] };
}

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
  const configured = legacyScheduleDays(schedule);
  const day = schedule.day_of_period == null || schedule.day_of_period === ''
    ? Number.NaN
    : Number(schedule.day_of_period);
  const basis = schedule.schedule_basis
    || (schedule.cadence === 'weekly' && day >= 0 && day <= 6 ? 'weekday' : 'month_days');
  let days = [];

  if (configured.length) {
    if (basis === 'weekday') {
      const weekdays = new Set(configured.filter(value => value >= 0 && value <= 6));
      const [year, month] = period.split('-').map(Number);
      for (let value = 1; value <= daysInMonth; value += 1) {
        if (weekdays.has(new Date(Date.UTC(year, month - 1, value)).getUTCDay())) days.push(value);
      }
    } else if (schedule.cadence === 'monthly') {
      days = [Math.min(configured[0], daysInMonth)];
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
  if (!slots.length) return schedule?.cadence === 'on_demand' ? 'حسب الطلب' : 'موعد غير مكتمل';
  return `${CADENCE_META[schedule.cadence]?.label || schedule.cadence} · ${slots.map(slot => slot.day).join('، ')}`;
}

export function carrierHasActiveContract(carrier, period) {
  const contracts = Array.isArray(carrier?.contracts) ? carrier.contracts : [];
  if (!contracts.length) return false;
  const [year, month] = String(period || '').split('-').map(Number);
  if (!year || month < 1 || month > 12) return false;
  const start = `${period}-01`;
  const endDate = new Date(Date.UTC(year, month, 1));
  const end = endDate.toISOString().slice(0, 10);
  return contracts.some(contract => {
    const contractStart = String(contract?.startDate || '').slice(0, 10);
    const contractEnd = String(contract?.endDate || '').slice(0, 10);
    return (!contractStart || contractStart < end) && (!contractEnd || contractEnd >= start);
  });
}

export function requiredScheduleKindsForCarrier(carrier) {
  const fileKind = String(carrier?.file_signature?.file_kind || '').trim();
  if (fileKind === 'audit_with_cod' || fileKind === 'audit_only') return ['invoice'];
  if (fileKind === 'audit_and_cod_separate') return ['invoice', 'cod_remittance'];
  if (fileKind === 'cod_only') return ['cod_remittance'];
  return [];
}

export function deriveCarrierScheduleCoverage({ carriers = [], schedules = [], period } = {}) {
  return (carriers || [])
    .filter(carrier => carrierHasActiveContract(carrier, period))
    .map(carrier => {
      const fileKind = String(carrier?.file_signature?.file_kind || '').trim() || null;
      const requiredKinds = requiredScheduleKindsForCarrier(carrier);
      if (!requiredKinds.length) {
        return {
          carrierId: String(carrier.id),
          carrierName: carrier.name || carrier.label || String(carrier.id),
          fileKind,
          status: 'unclassified',
          requiredKinds: [],
          missingKinds: [],
          invalidKinds: [],
        };
      }
      const carrierSchedules = (schedules || []).filter(schedule => schedule.active
        && String(schedule.carrier_id) === String(carrier.id));
      const missingKinds = requiredKinds.filter(kind => !carrierSchedules.some(schedule => schedule.task_kind === kind));
      const invalidKinds = requiredKinds.filter(kind => carrierSchedules.some(schedule => schedule.task_kind === kind
        && schedule.cadence !== 'on_demand'
        && expectedScheduleSlots(schedule, period).length === 0));
      return {
        carrierId: String(carrier.id),
        carrierName: carrier.name || carrier.label || String(carrier.id),
        fileKind,
        status: missingKinds.length || invalidKinds.length ? 'incomplete' : 'complete',
        requiredKinds,
        missingKinds,
        invalidKinds,
      };
    })
    .sort((a, b) => a.carrierName.localeCompare(b.carrierName, 'ar'));
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

function uniqueEvidenceRows(rows = [], keyOf) {
  const seen = new Set();
  return rows.filter(row => {
    const key = keyOf(row);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function evidenceDate(value) {
  return saDateParts(value)?.iso || null;
}

// Read-only evidence for helping a manager confirm missing carrier schedules.
// Historical uploads are never converted into a schedule automatically: a few
// late/manual uploads are not a contractual calendar. The UI only shows what
// actually exists and keeps the final date choice explicit.
export function summarizeCarrierScheduleEvidence({ carrierIds = [], audits = [], codRows = [] } = {}) {
  const ids = [...new Set((carrierIds || []).map(String).filter(Boolean))];
  const result = Object.fromEntries(ids.map(id => [id, {
    invoice: { batchCount: 0, dates: [] },
    cod: { batchCount: 0, dates: [] },
  }]));

  const invoiceBatches = uniqueEvidenceRows(
    (audits || []).filter(row => ids.includes(String(row.carrier_id))),
    row => `${row.carrier_id}:${row.id || row.content_hash || row.file_name || row.created_at}`,
  );
  invoiceBatches.forEach(row => {
    const carrierId = String(row.carrier_id);
    if (!result[carrierId]) return;
    result[carrierId].invoice.batchCount += 1;
    const date = evidenceDate(row.created_at);
    if (date) result[carrierId].invoice.dates.push(date);
  });

  const codBatches = uniqueEvidenceRows(
    (codRows || []).filter(row => ids.includes(String(row.carrier_id)) && row.direction === 'in'),
    row => `${row.carrier_id}:${row.upload_id || row.source_file || row.created_at}`,
  );
  codBatches.forEach(row => {
    const carrierId = String(row.carrier_id);
    if (!result[carrierId]) return;
    result[carrierId].cod.batchCount += 1;
    const date = evidenceDate(row.created_at);
    if (date) result[carrierId].cod.dates.push(date);
  });

  Object.values(result).forEach(evidence => {
    evidence.invoice.dates = [...new Set(evidence.invoice.dates)].sort();
    evidence.cod.dates = [...new Set(evidence.cod.dates)].sort();
  });
  return result;
}

export async function listCarrierScheduleEvidence(carrierIds = []) {
  const ids = [...new Set((carrierIds || []).map(String).filter(Boolean))];
  if (!ids.length) return {};
  const [auditsRes, codRes] = await Promise.all([
    supabase
      .from('audits')
      .select('id,carrier_id,file_name,content_hash,created_at')
      .in('carrier_id', ids)
      .order('created_at', { ascending: false })
      .limit(5000),
    supabase
      .from('cod_settlement')
      .select('carrier_id,upload_id,source_file,created_at,direction')
      .in('carrier_id', ids)
      .eq('direction', 'in')
      .order('created_at', { ascending: false })
      .limit(5000),
  ]);
  if (auditsRes.error) throw new Error(`تعذر قراءة سجل فواتير الناقلين: ${auditsRes.error.message}`);
  if (codRes.error) throw new Error(`تعذر قراءة سجل تحصيلات الناقلين: ${codRes.error.message}`);
  return summarizeCarrierScheduleEvidence({ carrierIds: ids, audits: auditsRes.data, codRows: codRes.data });
}

export async function upsertSchedule({
  id = null, carrierId, taskKind, cadence,
  dayOfPeriod = null, scheduleBasis = null, dueDays = [], notes = null, active = true,
}) {
  if (!carrierId || !taskKind || !cadence) {
    throw new Error('carrier_id و task_kind و cadence مطلوبة');
  }
  const timing = normalizeScheduleTiming({ cadence, scheduleBasis, dueDays, dayOfPeriod });
  const row = {
    carrier_id:    carrierId,
    task_kind:     taskKind,
    cadence,
    day_of_period: timing.dayOfPeriod,
    schedule_basis: timing.scheduleBasis,
    due_days: timing.dueDays,
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

function saDateParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const read = type => parts.find(part => part.type === type)?.value;
  const year = Number(read('year'));
  const month = Number(read('month'));
  const day = Number(read('day'));
  if (!year || !month || !day) return null;
  return { year, month, day, iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}

function shiftPeriod(period, offset) {
  const [year, month] = period.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

function dateDiffDays(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS);
}

// Compute due-state from the carrier's explicit calendar slots. A late upload
// never moves the next contractual date: completing a day-1 monthly invoice on
// day 10 still leaves the following invoice due on day 1 of the next month.
export function deriveDueState(schedule, now = new Date()) {
  const cadence = CADENCE_META[schedule.cadence];
  if (!cadence || cadence.days == null) {
    return { dueAt: null, isDue: false, isOverdue: false, daysUntilDue: null, label: 'حسب الطلب' };
  }
  const today = saDateParts(now);
  if (!today) return { dueAt: null, isDue: false, isOverdue: false, daysUntilDue: null, label: 'موعد غير صالح' };
  const currentPeriod = `${today.year}-${String(today.month).padStart(2, '0')}`;
  const createdIso = saDateParts(schedule.created_at)?.iso || `${currentPeriod}-01`;
  const completedIso = saDateParts(schedule.last_completed_at)?.iso || null;
  const slots = [-1, 0, 1, 2]
    .flatMap(offset => expectedScheduleSlots(schedule, shiftPeriod(currentPeriod, offset)))
    .map(slot => slot.dueDate)
    .filter(dueDate => dueDate >= createdIso && (!completedIso || dueDate > completedIso))
    .sort();
  const dueIso = slots[0] || null;
  if (!dueIso) {
    return { dueAt: null, isDue: false, isOverdue: false, daysUntilDue: null, label: 'لا يوجد موعد قادم' };
  }
  const daysUntilDue = dateDiffDays(today.iso, dueIso);
  const dueAt = new Date(`${dueIso}T00:00:00+03:00`);
  const isOverdue = daysUntilDue < 0;
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
