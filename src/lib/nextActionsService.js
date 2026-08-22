// شاشة الفعل التالي (Next Best Action) — أقوى ما يميّز مركز العمليات عن هاتف:
// يربط التواصل (ردّ حملة) بالمال (دين/محفظة) والشحن (توقّف) في قائمة إجراءات
// مرتّبة لكل عميل، مع سبب واضح وإجراء مقترح. المصدر RPC next_best_actions.
import { supabase } from './supabase.js';

// وصف كل نوع إشارة — أيقونة/لون/مجموعة الإجراء (نقطة الحقيقة للعرض).
export const NBA_META = {
  hot_reply:  { icon: '🔥', label: 'ردّ باهتمام — عميل حارّ', color: '#F97316', group: 'تواصل' },
  sla:        { icon: '⏰', label: 'متابعة متأخرة (SLA)', color: 'var(--red)', group: 'متابعة' },
  reply:      { icon: '↩️', label: 'ردّ لم يُتابَع', color: '#0EA5E9', group: 'تواصل' },
  wallet_neg: { icon: '👛', label: 'محفظة سالبة', color: 'var(--red)', group: 'تحصيل' },
  debt:       { icon: '💰', label: 'دين مفتوح', color: 'var(--red)', group: 'تحصيل' },
  stopped:    { icon: '😴', label: 'توقّف عن الشحن', color: 'var(--gold)', group: 'مبيعات' },
  new_registered: { icon: '👋', label: 'مسجل جديد', color: '#8B5CF6', group: 'الجدد', journey: 'new_customer' },
  new_ready:      { icon: '🚀', label: 'جاهز لأول شحنة', color: '#06B6D4', group: 'الجدد', journey: 'new_customer' },
  stopped_recent:{ icon: '⏸️', label: 'توقف حديثًا', color: 'var(--gold)', group: 'المتوقفون', journey: 'stopped_customer' },
  stopped_long:  { icon: '↩️', label: 'استعادة عميل', color: '#F97316', group: 'المتوقفون', journey: 'stopped_customer' },
};

export const TEMPLATE_INTENT_LABELS = {
  welcome_activation: 'قالب ترحيب وتفعيل',
  first_shipment: 'قالب مساعدة أول شحنة',
  reactivation: 'قالب إعادة تنشيط',
  collections_reminder: 'قالب تحصيل',
};

// حارس SLA — ملخّص المتابعات المتأخرة/الراكدة (لبطاقة المدير في /decisions).
export async function loadSlaBreaches() {
  const { data, error } = await supabase.rpc('sla_breaches');
  if (error || !Array.isArray(data) || !data.length) return null;
  const r = data[0];
  return { overdue: Number(r.overdue) || 0, stale: Number(r.stale) || 0, total: Number(r.total) || 0, oldestDays: Number(r.oldest_days) || 0 };
}
export async function loadNextBestActions({ owner = null, journey = null, limit = 1000 } = {}) {
  const { data, error } = await supabase.rpc('customer_growth_action_queue', {
    p_limit: limit,
    p_owner: owner,
    p_journey: journey,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(r => ({
    phone: r.phone,
    name: r.name || r.phone,
    storeId: r.store_id,
    ownerId: r.owner_id,
    reasonCode: r.reason_code,
    journey: r.journey,
    reason: r.reason,
    action: r.action,
    priority: Number(r.priority) || 0,
    amount: r.amount == null ? null : Number(r.amount),
    followupStatus: r.followup_status,
    lastTouch: r.last_touch,
    recommendedChannel: r.recommended_channel,
    recommendedTemplateKey: r.recommended_template_key,
    sendEligible: r.send_eligible === true,
    guardCode: r.guard_code,
    guardReason: r.guard_reason,
    lastCampaignAt: r.last_campaign_at,
    lastCallAt: r.last_call_at,
    sourceSnapshotAt: r.source_snapshot_at,
  }));
}

const mapNextAction = r => ({
  phone: r.phone,
  name: r.name || r.phone,
  storeId: r.store_id,
  ownerId: r.owner_id,
  ownerName: r.owner_name || null,
  reasonCode: r.reason_code,
  journey: r.journey,
  reason: r.reason,
  action: r.action,
  priority: Number(r.priority) || 0,
  amount: r.amount == null ? null : Number(r.amount),
  followupStatus: r.followup_status,
  lastTouch: r.last_touch,
  recommendedChannel: r.recommended_channel,
  recommendedTemplateKey: r.recommended_template_key,
  sendEligible: r.send_eligible === true,
  guardCode: r.guard_code,
  guardReason: r.guard_reason,
  lastCampaignAt: r.last_campaign_at,
  lastCallAt: r.last_call_at,
  sourceSnapshotAt: r.source_snapshot_at,
});

const SALES_CORE_READ_ENABLED = String(import.meta.env.VITE_SALES_CORE_READ_ENABLED ?? 'true') !== 'false';

const buildLegacyPage = async ({ owner, group, safePage, safePageSize }) => {
  const legacyRows = await loadNextBestActions({ owner, limit: 1000 });
  const filtered = group
    ? legacyRows.filter(row => NBA_META[row.reasonCode]?.group === group)
    : legacyRows;
  const offset = safePage * safePageSize;
  const rows = filtered.slice(offset, offset + safePageSize);
  const byGroup = {};
  let money = 0;
  let ready = 0;
  for (const row of filtered) {
    money += Number(row.amount) || 0;
    if (row.sendEligible) ready += 1;
    const rowGroup = NBA_META[row.reasonCode]?.group || '—';
    byGroup[rowGroup] = (byGroup[rowGroup] || 0) + 1;
  }
  return {
    rows,
    count: filtered.length,
    summary: { count: filtered.length, money, ready, held: filtered.length - ready, byGroup },
    pageInfo: { limit: safePageSize, offset, hasNext: offset + safePageSize < filtered.length },
    readPath: 'legacy',
  };
};

export async function loadNextBestActionsPage({
  owner = null,
  group = null,
  page = 0,
  pageSize = 50,
} = {}) {
  const safePage = Math.max(0, Number(page) || 0);
  const safePageSize = Math.max(1, Math.min(Number(pageSize) || 50, 100));
  if (!SALES_CORE_READ_ENABLED) {
    return buildLegacyPage({ owner, group, safePage, safePageSize });
  }
  const { data, error } = await supabase.rpc('customer_growth_action_queue_page', {
    p_page_size: safePageSize,
    p_offset: safePage * safePageSize,
    p_owner: owner,
    p_group: group,
  });
  if (error) {
    // Authorization failures must never widen into the legacy all-team queue.
    if (/not_allowed|permission|scope/i.test(`${error.code || ''} ${error.message || ''}`)) throw error;
    console.warn('[sales-read] paginated queue unavailable; using legacy fallback', error.code || error.message);
    return buildLegacyPage({ owner, group, safePage, safePageSize });
  }
  const value = data || {};
  return {
    rows: (Array.isArray(value.rows) ? value.rows : []).map(mapNextAction),
    count: Number(value.count) || 0,
    summary: {
      count: Number(value.summary?.count) || 0,
      money: Number(value.summary?.money) || 0,
      ready: Number(value.summary?.ready) || 0,
      held: Number(value.summary?.held) || 0,
      byGroup: value.summary?.by_group || {},
    },
    pageInfo: {
      limit: Number(value.page_info?.limit) || safePageSize,
      offset: Number(value.page_info?.offset) || safePage * safePageSize,
      hasNext: value.page_info?.has_next === true,
    },
    readPath: 'customer_growth_action_queue_page',
  };
}

export async function loadAllNextBestActions(filters = {}, { maxRows = 1000 } = {}) {
  const rows = [];
  const pageSize = 100;
  for (let page = 0; rows.length < maxRows; page += 1) {
    const result = await loadNextBestActionsPage({ ...filters, page, pageSize });
    rows.push(...result.rows);
    if (!result.pageInfo.hasNext || !result.rows.length) break;
  }
  return rows.slice(0, maxRows);
}

export async function loadCustomerGrowthSnapshot(days = 30) {
  const { data, error } = await supabase.rpc('customer_growth_operating_snapshot', {
    p_days: days,
  });
  if (error) throw error;
  return data || null;
}

export async function loadCustomerGrowthProfile(phone) {
  const { data, error } = await supabase.rpc('customer_growth_profile', {
    p_phone: phone,
  });
  if (error) throw error;
  return data || null;
}

export async function recordCustomerGrowthOutcome({
  phone,
  reasonCode,
  outcome,
  nextAt = null,
  activityType = 'call',
  note = null,
}) {
  const { data, error } = await supabase.rpc('record_customer_growth_outcome', {
    p_phone: phone,
    p_reason_code: reasonCode,
    p_outcome: outcome,
    p_next: nextAt,
    p_activity_type: activityType,
    p_note: note,
  });
  if (error) throw error;
  return data;
}
