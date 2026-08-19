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
