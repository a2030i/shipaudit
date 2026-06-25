// crmService.js — CRM/التحصيل + المبيعات.
//
// طبقة تشغيلية فوق الأصول الموجودة (receivables/merchants/computeRisk/
// profiles). لا تكرّر بياناتها — تُجلب overlay وقت التشغيل من الصفحات.
//
// الجداول: crm_statuses · crm_stages · crm_customer_crm · crm_leads ·
//          crm_deals · crm_activities · crm_tasks  (RLS صارم: المُسنَد له فقط)
//
// المفتاح الدائم للعميل = customer_name (نفس receivables). الـtimeline
// polymorphic عبر (entity_type, entity_ref): customer=الاسم، lead/deal=uuid نصّي.

import { supabase } from './supabase.js';
import { computeRisk } from './customerRisk.js';

const nowIso = () => new Date().toISOString();

// تطبيع عربي خفيف (لكشف تكرار الجهات) — يطابق منطق merchantsService.
const DIACRITICS = /[ً-ْٰ]/g;
export function normalizeName(s) {
  if (!s) return '';
  return String(s).toLowerCase()
    .replace(DIACRITICS, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^0-9a-zء-ي\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────
// بيانات مرجعية: الحالات + مراحل البيع (cache بسيط على مستوى الـmodule)
// ─────────────────────────────────────────────────────────────────────
let _statusCache = null, _stageCache = null;

export async function loadStatuses({ force = false } = {}) {
  if (_statusCache && !force) return _statusCache;
  const { data, error } = await supabase.from('crm_statuses').select('*').order('sort_order');
  if (error) throw error;
  _statusCache = data || [];
  return _statusCache;
}

export async function loadStages({ force = false } = {}) {
  if (_stageCache && !force) return _stageCache;
  const { data, error } = await supabase.from('crm_stages').select('*').order('sort_order');
  if (error) throw error;
  _stageCache = data || [];
  return _stageCache;
}

// تخصيص الحالات/المراحل من الواجهة (crm.manage_statuses)
export async function upsertStatus(row) {
  const { data, error } = await supabase.from('crm_statuses').upsert(row).select().single();
  if (error) throw error;
  _statusCache = null;
  return data;
}
export async function deleteStatus(id) {
  const { error } = await supabase.from('crm_statuses').delete().eq('id', id);
  if (error) throw error;
  _statusCache = null;
  return { ok: true };
}
export async function upsertStage(row) {
  const { data, error } = await supabase.from('crm_stages').upsert(row).select().single();
  if (error) throw error;
  _stageCache = null;
  return data;
}
export async function deleteStage(id) {
  const { error } = await supabase.from('crm_stages').delete().eq('id', id);
  if (error) throw error;
  _stageCache = null;
  return { ok: true };
}

async function defaultStatusId() {
  const s = await loadStatuses();
  return (s.find(x => x.is_default) || s[0])?.id || null;
}
async function terminalStatusIds() {
  const s = await loadStatuses();
  return new Set(s.filter(x => x.is_terminal).map(x => x.id));
}

// ─────────────────────────────────────────────────────────────────────
// التحويل الآلي: أي عميل غير نشط/متعثّر يدخل المتابعة (المتطلب 1)
//   customers = قائمة receivables المُثراة (نفس مدخل regenerateTasks)
//   Idempotent: لا يُعيد إدخال المُدرَج سلفاً، ولا يكتب فوق owner/status يدويّين،
//   ولا يُعيد إدراج حالة منتهية (محصَّل/أُوقِف/شطب).
// ─────────────────────────────────────────────────────────────────────
function watchReasonFor(c) {
  const flags = new Set([c?.anomaly, ...(c?.anomalyExtras || [])].filter(Boolean));
  const risk = computeRisk(c);
  if (risk.shouldStop) return 'shouldStop';
  if (flags.has('inactive_with_debt')) return 'inactive_with_debt';
  if (c?.merchant?.platformStatus === 'غير نشط' && (Number(c?.total) || 0) > 0.5) return 'inactive_with_debt';
  if (flags.has('prepaid_with_debt')) return 'prepaid_anomaly';
  return null;
}

export async function crmAutoEnroll({ customers, userId = null } = {}) {
  if (!Array.isArray(customers) || !customers.length) return { enrolled: 0 };

  // المرشّحون: لهم سبب متابعة
  const cands = [];
  for (const c of customers) {
    const reason = watchReasonFor(c);
    if (reason) cands.push({ name: c.name, reason });
  }
  if (!cands.length) return { enrolled: 0 };

  const names = cands.map(c => c.name);
  const termIds = await terminalStatusIds();
  const defId = await defaultStatusId();

  // الموجود مسبقاً (لتفادي الكتابة فوق اليدوي + الحالات المنتهية)
  const existing = new Map();
  for (let i = 0; i < names.length; i += 300) {
    const chunk = names.slice(i, i + 300);
    const { data } = await supabase.from('crm_customer_crm')
      .select('customer_name, in_watch, followup_status_id').in('customer_name', chunk);
    (data || []).forEach(r => existing.set(r.customer_name, r));
  }

  const toInsert = [], toReEnroll = [], systemRows = [];
  for (const { name, reason } of cands) {
    const ex = existing.get(name);
    if (!ex) {
      toInsert.push({
        customer_name: name, name_normalized: normalizeName(name),
        in_watch: true, watch_reason: reason, followup_status_id: defId,
        last_activity_at: nowIso(), updated_at: nowIso(),
      });
      systemRows.push({ entity_type: 'customer', entity_ref: name, kind: 'system',
        summary: `دخل المتابعة آلياً: ${reason}`, owner_id: userId, created_by: userId });
    } else if (!ex.in_watch && !termIds.has(ex.followup_status_id)) {
      toReEnroll.push({ name, reason });
    }
  }

  // إدراج الجدد (chunked)
  let enrolled = 0;
  for (let i = 0; i < toInsert.length; i += 200) {
    const chunk = toInsert.slice(i, i + 200);
    const { error } = await supabase.from('crm_customer_crm').insert(chunk);
    if (!error) enrolled += chunk.length;
  }
  // إعادة تفعيل المتابعة للموجودين (بلا مسّ owner/status)
  for (const { name, reason } of toReEnroll) {
    const { error } = await supabase.from('crm_customer_crm')
      .update({ in_watch: true, watch_reason: reason, updated_at: nowIso() })
      .eq('customer_name', name);
    if (!error) {
      enrolled++;
      systemRows.push({ entity_type: 'customer', entity_ref: name, kind: 'system',
        summary: `أُعيد للمتابعة آلياً: ${reason}`, owner_id: userId, created_by: userId });
    }
  }
  // سجلّ النظام (لا يوقف الإثراء لو فشل)
  for (let i = 0; i < systemRows.length; i += 200) {
    await supabase.from('crm_activities').insert(systemRows.slice(i, i + 200));
  }
  return { enrolled };
}

// ─────────────────────────────────────────────────────────────────────
// قائمة المتابعة: صفوف crm_customer_crm (RLS تقيّدها) + overlay من receivables
//   customers = قائمة receivables المُثراة (للإثراء بالدين/العمر/الخطر)
// ─────────────────────────────────────────────────────────────────────
export async function loadWatchQueue({ customers = [] } = {}) {
  const [{ data: rows, error }, statuses] = await Promise.all([
    supabase.from('crm_customer_crm').select('*').eq('in_watch', true),
    loadStatuses(),
  ]);
  if (error) throw error;
  const statusById = new Map(statuses.map(s => [s.id, s]));
  const custByName = new Map((customers || []).map(c => [c.name, c]));

  return (rows || []).map(r => {
    const c = custByName.get(r.customer_name) || {};
    const risk = c.name ? computeRisk(c) : { score: 0, level: { label: '—', color: '#9CA3AF' } };
    return {
      ...r,
      status: statusById.get(r.followup_status_id) || null,
      total: Number(c.total) || 0,
      daysOutstanding: c.daysOutstanding || 0,
      overLimit: !!c.overLimit,
      merchant: c.merchant || null,
      anomaly: c.anomaly || null,
      risk,
    };
  }).sort((a, b) => b.risk.score - a.risk.score
    || (b.total - a.total));
}

// ضمان وجود صف crm للعميل (قبل تسجيل نشاط/تغيير حالة على عميل خارج المتابعة)
export async function ensureCustomerRow(customerName) {
  if (!customerName) throw new Error('customer_name مطلوب');
  const { data } = await supabase.from('crm_customer_crm')
    .select('customer_name').eq('customer_name', customerName).maybeSingle();
  if (data) return;
  const defId = await defaultStatusId();
  await supabase.from('crm_customer_crm').insert({
    customer_name: customerName, name_normalized: normalizeName(customerName),
    followup_status_id: defId, last_activity_at: nowIso(),
  });
}

// ─────────────────────────────────────────────────────────────────────
// الـtimeline: تسجيل نشاط (مكالمة/ملاحظة/إفادة/وعد/تغيير حالة)
// ─────────────────────────────────────────────────────────────────────
export async function logActivity({
  entityType, entityRef, kind, disposition = null, summary = null, body = null,
  promiseAmount = null, promisedOn = null, channelRef = null, templateKey = null,
  occurredAt = null, userId = null,
}) {
  if (!entityType || !entityRef || !kind) throw new Error('entityType/entityRef/kind مطلوبة');
  const row = {
    entity_type: entityType, entity_ref: String(entityRef), kind,
    disposition, summary, body,
    promise_amount: promiseAmount, promised_on: promisedOn,
    promise_status: kind === 'promise' ? 'open' : null,
    channel_ref: channelRef, template_key: templateKey,
    occurred_at: occurredAt || nowIso(), owner_id: userId, created_by: userId,
  };
  const { data, error } = await supabase.from('crm_activities').insert(row).select().single();
  if (error) throw error;
  if (entityType === 'customer') {
    await supabase.from('crm_customer_crm')
      .update({ last_activity_at: row.occurred_at, updated_at: nowIso() })
      .eq('customer_name', String(entityRef));
  }
  return data;
}

export async function loadTimeline({ entityType, entityRef, limit = 200 }) {
  if (!entityType || !entityRef) throw new Error('entityType/entityRef مطلوبة');
  const { data, error } = await supabase.from('crm_activities')
    .select('*').eq('entity_type', entityType).eq('entity_ref', String(entityRef))
    .order('occurred_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

// وعد بالدفع (PTP) — نشاط من نوع promise
export async function recordPromise({ entityType = 'customer', entityRef, amount, date, body = null, userId = null }) {
  if (!entityRef || !amount || !date) throw new Error('entityRef/amount/date مطلوبة');
  return logActivity({
    entityType, entityRef, kind: 'promise', summary: `وعد بدفع ${Number(amount).toLocaleString('en-US')} ر.س بتاريخ ${date}`,
    body, promiseAmount: Number(amount), promisedOn: date, userId,
  });
}

// إغلاق وعد (kept/partial/broken)
export async function resolvePromise(activityId, { status, keptAmount = null }) {
  if (!activityId || !status) throw new Error('activityId/status مطلوبة');
  const { data, error } = await supabase.from('crm_activities')
    .update({ promise_status: status, kept_amount: keptAmount })
    .eq('id', activityId).select().single();
  if (error) throw error;
  return data;
}

// الوعود المكسورة: open تجاوزت تاريخها +N يوم بلا دفع (لبطاقة /decisions)
export async function loadBrokenPromises({ graceDays = 3 } = {}) {
  const cutoff = new Date(Date.now() - graceDays * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase.from('crm_activities')
    .select('*').eq('kind', 'promise').eq('promise_status', 'open').lt('promised_on', cutoff)
    .order('promised_on', { ascending: true });
  if (error) throw error;
  return data || [];
}

// ─────────────────────────────────────────────────────────────────────
// الحالة + الإسناد
// ─────────────────────────────────────────────────────────────────────
export async function changeStatus({ customerName, statusId, userId = null }) {
  if (!customerName || !statusId) throw new Error('customerName/statusId مطلوبة');
  await ensureCustomerRow(customerName);
  const statuses = await loadStatuses();
  const st = statuses.find(s => s.id === statusId);
  const patch = { followup_status_id: statusId, updated_at: nowIso() };
  if (st?.is_terminal) patch.in_watch = false;       // الحالة المنتهية تخرج من الطابور
  const { error } = await supabase.from('crm_customer_crm').update(patch).eq('customer_name', customerName);
  if (error) throw error;
  await logActivity({ entityType: 'customer', entityRef: customerName, kind: 'status_change',
    summary: `تغيّرت الحالة إلى: ${st?.label_ar || statusId}`, userId });
  return { ok: true };
}

export async function assignOwner({ entityType, entityRef, ownerId, ownerName = null, userId = null }) {
  if (!entityType || !entityRef) throw new Error('entityType/entityRef مطلوبة');
  const table = entityType === 'customer' ? 'crm_customer_crm'
    : entityType === 'lead' ? 'crm_leads' : 'crm_deals';
  const keyCol = entityType === 'customer' ? 'customer_name' : 'id';
  const { error } = await supabase.from(table)
    .update({ owner_id: ownerId, updated_at: nowIso() }).eq(keyCol, entityType === 'customer' ? entityRef : String(entityRef));
  if (error) throw error;
  // تحويل المهام المفتوحة للمُسنَد الجديد (نموذج Zoho)
  await supabase.from('crm_tasks').update({ assigned_to: ownerId, updated_at: nowIso() })
    .eq('entity_type', entityType).eq('entity_ref', String(entityRef)).eq('status', 'open');
  await logActivity({ entityType, entityRef, kind: 'system',
    summary: ownerName ? `أُسنِد إلى: ${ownerName}` : 'تغيّر المُسنَد', userId });
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────
// المهام/المواعيد (الجدولة)
// ─────────────────────────────────────────────────────────────────────
export async function loadTasks({ assignee = null, entityType = null, entityRef = null, openOnly = true } = {}) {
  let q = supabase.from('crm_tasks').select('*').order('due_at', { ascending: true });
  if (openOnly) q = q.eq('status', 'open');
  if (assignee) q = q.eq('assigned_to', assignee);
  if (entityType && entityRef) q = q.eq('entity_type', entityType).eq('entity_ref', String(entityRef));
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function createTask({
  entityType, entityRef, title, kind = 'followup', dueAt,
  remindDaysBefore = 0, remindChannel = 'popup', priority = 'normal',
  assignedTo = null, sourcePromiseId = null, userId = null,
}) {
  if (!entityRef || !title || !dueAt) throw new Error('entityRef/title/dueAt مطلوبة');
  const { data, error } = await supabase.from('crm_tasks').insert({
    entity_type: entityType, entity_ref: String(entityRef), title, kind,
    due_at: dueAt, remind_days_before: remindDaysBefore, remind_channel: remindChannel,
    priority, assigned_to: assignedTo, source_promise_id: sourcePromiseId, created_by: userId,
  }).select().single();
  if (error) throw error;
  if (entityType === 'customer') {
    // حدّث «الإجراء التالي» = أقرب مهمة مفتوحة
    await refreshNextAction(String(entityRef));
  }
  return data;
}

export async function completeTask(id, userId = null) {
  if (!id) throw new Error('id مطلوب');
  const { data, error } = await supabase.from('crm_tasks')
    .update({ status: 'done', completed_at: nowIso(), completed_by: userId, updated_at: nowIso() })
    .eq('id', id).select().single();
  if (error) throw error;
  if (data?.entity_type === 'customer') await refreshNextAction(data.entity_ref);
  return data;
}

export async function cancelTask(id) {
  if (!id) throw new Error('id مطلوب');
  const { error } = await supabase.from('crm_tasks').update({ status: 'cancelled', updated_at: nowIso() }).eq('id', id);
  if (error) throw error;
  return { ok: true };
}

async function refreshNextAction(customerName) {
  const { data } = await supabase.from('crm_tasks')
    .select('due_at').eq('entity_type', 'customer').eq('entity_ref', customerName)
    .eq('status', 'open').order('due_at', { ascending: true }).limit(1);
  const next = data?.[0]?.due_at || null;
  await supabase.from('crm_customer_crm').update({ next_action_at: next, updated_at: nowIso() }).eq('customer_name', customerName);
}

// ─────────────────────────────────────────────────────────────────────
// المبيعات: الصفقات (pipeline)
// ─────────────────────────────────────────────────────────────────────
export async function loadDeals({ status = 'open', ownerId = null } = {}) {
  const [{ data, error }, stages] = await Promise.all([
    (() => {
      let q = supabase.from('crm_deals').select('*').order('updated_at', { ascending: false });
      if (status) q = q.eq('status', status);
      if (ownerId) q = q.eq('owner_id', ownerId);
      return q;
    })(),
    loadStages(),
  ]);
  if (error) throw error;
  const stageById = new Map(stages.map(s => [s.id, s]));
  return (data || []).map(d => ({ ...d, stage: stageById.get(d.stage_id) || null }));
}

export async function createDeal({ title, entityType, entityRef, stageId = null, value = 0, expectedClose = null, ownerId = null, userId = null }) {
  if (!title || !entityType || !entityRef) throw new Error('title/entityType/entityRef مطلوبة');
  let stage = stageId;
  if (!stage) { const stages = await loadStages(); stage = stages[0]?.id || null; }
  const { data, error } = await supabase.from('crm_deals').insert({
    title, entity_type: entityType, entity_ref: String(entityRef), stage_id: stage,
    value: Number(value) || 0, expected_close: expectedClose, owner_id: ownerId, created_by: userId,
  }).select().single();
  if (error) throw error;
  await logActivity({ entityType, entityRef, kind: 'system', summary: `أُنشئت صفقة: ${title}`, userId });
  return data;
}

export async function moveDeal(id, stageId, { userId = null } = {}) {
  if (!id || !stageId) throw new Error('id/stageId مطلوبة');
  const stages = await loadStages();
  const st = stages.find(s => s.id === stageId);
  const patch = { stage_id: stageId, updated_at: nowIso() };
  if (st?.is_won)  { patch.status = 'won';  patch.closed_at = nowIso(); }
  if (st?.is_lost) { patch.status = 'lost'; patch.closed_at = nowIso(); }
  const { data, error } = await supabase.from('crm_deals').update(patch).eq('id', id).select().single();
  if (error) throw error;
  await logActivity({ entityType: data.entity_type, entityRef: data.entity_ref, kind: 'stage_change',
    summary: `تحرّكت الصفقة إلى: ${st?.label_ar || stageId}`, userId });
  return data;
}

export async function closeDeal(id, { won, lostReason = null, userId = null }) {
  if (!id) throw new Error('id مطلوب');
  const stages = await loadStages();
  const target = stages.find(s => (won ? s.is_won : s.is_lost));
  return moveDeal(id, target?.id, { userId }).then(async (d) => {
    if (!won && lostReason) await supabase.from('crm_deals').update({ lost_reason: lostReason }).eq('id', id);
    return d;
  });
}

// ─────────────────────────────────────────────────────────────────────
// لوحة الأداء (board) — تجميعات
// ─────────────────────────────────────────────────────────────────────
export async function loadBoardStats() {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [acts, promises, deals] = await Promise.all([
    supabase.from('crm_activities').select('kind, owner_id, occurred_at').gte('occurred_at', weekAgo),
    supabase.from('crm_activities').select('promise_status, promise_amount, kept_amount').eq('kind', 'promise'),
    supabase.from('crm_deals').select('status, value, stage_id'),
  ]);
  const touchesThisWeek = (acts.data || []).filter(a => ['call', 'whatsapp', 'note', 'visit', 'meeting'].includes(a.kind)).length;
  const p = promises.data || [];
  const promisesOpen = p.filter(x => x.promise_status === 'open').length;
  const promisesKept = p.filter(x => x.promise_status === 'kept').length;
  const promisesBroken = p.filter(x => x.promise_status === 'broken').length;
  const d = deals.data || [];
  const dealsOpen = d.filter(x => x.status === 'open');
  const pipelineValue = dealsOpen.reduce((s, x) => s + (Number(x.value) || 0), 0);
  const wonValue = d.filter(x => x.status === 'won').reduce((s, x) => s + (Number(x.value) || 0), 0);
  return {
    touchesThisWeek, promisesOpen, promisesKept, promisesBroken,
    dealsOpenCount: dealsOpen.length, pipelineValue, wonValue,
  };
}

// ─────────────────────────────────────────────────────────────────────
// إشارات «شاشة الصباح» (/decisions): وعود مكسورة + متابعات مستحقة اليوم
//   RLS تقيّدها تلقائياً للمُسنَد له (الأدمن يرى الكل).
// ─────────────────────────────────────────────────────────────────────
export async function loadCrmDecisionSignals({ graceDays = 3 } = {}) {
  const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
  const [broken, watch] = await Promise.all([
    loadBrokenPromises({ graceDays }),
    supabase.from('crm_customer_crm').select('customer_name, next_action_at, last_activity_at')
      .eq('in_watch', true),
  ]);
  const rows = watch.data || [];
  // مستحقة الآن: لها موعد تالٍ مرّ/اليوم، أو بلا أي إجراء تالٍ مجدوَل (Pipedrive activity-first)
  const dueFollowups = rows.filter(r =>
    !r.next_action_at || new Date(r.next_action_at).getTime() <= endToday.getTime());
  const brokenTotal = broken.reduce((s, p) => s + (Number(p.promise_amount) || 0), 0);
  return {
    brokenPromises: broken, brokenCount: broken.length, brokenTotal,
    dueFollowups, dueCount: dueFollowups.length, watchCount: rows.length,
  };
}
