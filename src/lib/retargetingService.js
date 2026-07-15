// خدمة داشبورد إعادة استهداف العملاء (المرحلة 2) — تقرأ محرّك التصنيف
// (v_crm_retargeting) عبر RPCs: ملخّص + فرص مفلترة مُرقّمة + التقاط التغيّر
// بين رفعات ملف المتاجر. المصدر = أحدث snapshot للمتاجر (stores.xlsx).
import { supabase } from './supabase.js';

// تسميات وألوان الشرائح/الأولوية/القناة — نقطة الحقيقة الواحدة للعرض.
export const SEGMENTS = {
  new_active:        { label: 'جديد نشط',            color: '#0EA5E9', icon: '🆕' },
  topped_no_ship:    { label: 'شحن رصيد ولم يشحن',   color: '#F59E0B', icon: '💳' },
  linked_no_ship:    { label: 'ربط ولم يشحن',        color: '#8B5CF6', icon: '🔌' },
  registered_no_ship:{ label: 'سجّل ولم يشحن',       color: 'var(--muted)', icon: '📝' },
  stopped_recent:    { label: 'توقّف حديثاً',         color: '#F97316', icon: '⏸️' },
  stopped_long:      { label: 'توقّف قديماً',         color: '#B91C1C', icon: '🕰️' },
  active:            { label: 'نشط',                 color: 'var(--green)', icon: '✅' },
  negative_balance:  { label: 'رصيد سالب',           color: 'var(--red)', icon: '🛑' },
};
export const PRIORITIES = {
  A:    { label: 'A — اتصال شخصي', color: 'var(--red)' },
  B:    { label: 'B — واتساب',     color: '#F97316' },
  C:    { label: 'C — تفعيل',      color: 'var(--gold)' },
  D:    { label: 'D — حملة عامة',  color: 'var(--muted)' },
  FIN:  { label: 'مالية',          color: '#8B5CF6' },
  none: { label: 'نشط (لا استهداف)', color: 'var(--green)' },
};
export const CHANNELS = {
  call:             'اتصال شخصي',
  whatsapp:         'واتساب',
  whatsapp_balance: 'واتساب — تذكير رصيد',
  activation:       'حملة تفعيل',
  grow:             'تنمية',
  finance:          'تحويل للمالية',
};

// حالات المتابعة (دورة حياة الـLead + نتيجة التواصل + سبب التوقّف في حقل واحد).
export const STATUSES = {
  new:               { label: 'جديد',          color: 'var(--muted)' },
  contacted:         { label: 'تم التواصل',    color: '#0EA5E9' },
  whatsapp_sent:     { label: 'أُرسل واتساب',   color: '#22C55E' },
  no_answer:         { label: 'لم يرد',        color: 'var(--gold)' },
  interested:        { label: 'مهتم',          color: 'var(--green)' },
  needs_followup:    { label: 'يحتاج متابعة',  color: '#F97316' },
  returned:          { label: 'عاد للشحن',     color: '#16A34A' },
  not_interested:    { label: 'غير مهتم',      color: 'var(--muted2)' },
  price_issue:       { label: 'مشكلة سعر',     color: '#EF4444' },
  support_issue:     { label: 'مشكلة دعم',     color: '#EF4444' },
  integration_issue: { label: 'مشكلة ربط',     color: '#EF4444' },
  competitor:        { label: 'انتقل لمنافس',  color: '#B91C1C' },
  closed_business:   { label: 'توقّف نشاطه',    color: '#B91C1C' },
  finance:           { label: 'تسوية مالية',   color: '#8B5CF6' },
  // توحيد المتابعة (§1.32 تكملة): حالات «فرص من هاتف» انضمّت للمفردات الموحّدة —
  // نظام متابعة واحد (retargeting_followups) لكل تبويبات مركز المبيعات.
  converted:         { label: '✅ تحوّل لعميل',  color: '#16A34A' },
  // حالات الاستبعاد الدائم — تُخفَى من القوائم افتراضياً (لا يُكلَّمون)
  supplier:          { label: '📦 مورد/شريك',   color: '#8B5CF6', excluded: true },
  noise:             { label: 'أرقام غير مهمة', color: 'var(--muted2)', excluded: true },
  blacklist:         { label: '🚫 بلاك لست',    color: '#111827', excluded: true },
  test:              { label: '🧪 متجر تجريبي', color: 'var(--muted2)', excluded: true },
};

export function segmentMeta(k)  { return SEGMENTS[k]   || { label: k, color: 'var(--muted)', icon: '•' }; }
export function priorityMeta(k) { return PRIORITIES[k] || { label: k, color: 'var(--muted)' }; }
export function statusMeta(k)   { return STATUSES[k]   || { label: k, color: 'var(--muted)' }; }

// كتابة/تحديث متابعة عميل (بالهاتف). p_touch=true يحدّث «آخر تواصل».
export async function setRetargetingFollowup(phone, { status = null, ownerId = null, nextAt = null, notes = null, touch = false } = {}) {
  const { data, error } = await supabase.rpc('set_retargeting_followup', {
    p_phone: phone, p_status: status, p_owner: ownerId || null,
    p_next: nextAt || null, p_notes: notes, p_touch: !!touch,
  });
  if (error) throw error;
  return data;
}

// أداء الحملة (المرحلة 4): قمع التحويل + أداء الموظفين + الشرائح + العودة الآلية.
export async function loadRetargetingCampaign() {
  const [campRes, reactRes] = await Promise.all([
    supabase.rpc('crm_retargeting_campaign_stats'),
    supabase.rpc('crm_retargeting_reactivations'),
  ]);
  if (campRes.error) throw campRes.error;
  const d = campRes.data || {};
  const r = (reactRes && !reactRes.error && reactRes.data) ? reactRes.data : {};
  return {
    funnel: d.funnel || { universe: 0, worked: 0, contacted: 0, interested: 0, returned: 0, lost: 0, blocked: 0 },
    byStatus: d.by_status || {},
    byOwner: Array.isArray(d.by_owner) ? d.by_owner : [],
    bySegment: Array.isArray(d.by_segment) ? d.by_segment : [],
    // العودة الآلية: مقارنة الشحنات بين أحدث رفعتين (موضوعية، بلا تعليم يدوي)
    reactivations: {
      hasPrevious: !!r.has_previous,
      previousDate: r.previous_date || null,
      currentDate: r.current_date || null,
      allReactivated: Number(r.all_reactivated) || 0,
      allShipments: Number(r.all_shipments_generated) || 0,
      workedReactivated: Number(r.worked_reactivated) || 0,
      workedShipments: Number(r.worked_shipments_generated) || 0,
      workedTotal: Number(r.worked_total) || 0,
    },
  };
}

// سجلّ تغيّرات الحالات (من → إلى، بمن، متى) — «نعرف أي تغيرات صارت».
export async function loadRetargetingStatusChanges(limit = 50) {
  const { data, error } = await supabase.rpc('crm_retargeting_status_changes', { p_limit: limit });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(r => ({
    phone: r.phone, storeName: r.primary_store || '',
    oldStatus: r.old_status, newStatus: r.new_status,
    changedAt: r.changed_at, changedBy: r.changed_by_name || '—',
  }));
}

// إحصائيات المتابعة (توزيع الحالات + المستحقّة اليوم + عادوا).
export async function loadRetargetingFollowupStats() {
  const { data, error } = await supabase.rpc('crm_retargeting_followup_stats');
  if (error) throw error;
  const d = data || {};
  return {
    byStatus: d.by_status || {},
    assigned: Number(d.assigned) || 0,
    dueToday: Number(d.due_today) || 0,
    returned: Number(d.returned) || 0,
  };
}

// الداشبورد: ملخّص + توزيعات + التقاط التغيّر (الحالي مقابل الرفعة السابقة).
export async function loadRetargetingDashboard() {
  // ملاحظة: supabase.rpc() يرجّع builder (thenable) لا Promise — لا .catch عليه.
  // ويحلّ إلى { data, error } دون رفض، فنعالج الخطأ من الحقل لا بـ try/catch.
  const [sumRes, changeRes] = await Promise.all([
    supabase.rpc('crm_retargeting_summary'),
    supabase.rpc('capture_retargeting_summary'),
  ]);
  if (sumRes.error) throw sumRes.error;
  const s = sumRes.data || {};
  const change = (changeRes && !changeRes.error && changeRes.data) ? changeRes.data : {};
  const cur = change.current || s.stats || {};
  const prev = change.previous || null;
  // فروق الرفعة (current − previous) لكل مؤشّر + نسبة مئوية
  const delta = {};
  if (prev) {
    for (const k of Object.keys(cur)) {
      const a = Number(cur[k]) || 0, b = Number(prev[k]) || 0;
      delta[k] = { abs: +(a - b).toFixed(2), pct: b ? +(((a - b) / b) * 100).toFixed(1) : null };
    }
  }
  return {
    stats: s.stats || cur,
    segments: s.segments || {},
    priorities: s.priorities || {},
    integrations: s.integrations || {},
    previous: prev,
    delta,
    hasPrevious: !!prev,
    currentDate: change.current_date || null,
  };
}

// الفرص المفلترة المُرقّمة (من RPC crm_retargeting_leads).
export async function loadRetargetingLeads({
  segment = null, priority = null, integration = null, billing = null,
  hasBalance = null, q = null, status = null, ownerId = null, unassigned = null,
  includeExcluded = false, page = 0, limit = 50,
} = {}) {
  const { data, error } = await supabase.rpc('crm_retargeting_leads', {
    p_segment: segment || null,
    p_priority: priority || null,
    p_integration: integration || null,
    p_billing: billing || null,
    p_has_balance: hasBalance,
    p_q: q || null,
    p_status: status || null,
    p_owner: ownerId || null,
    p_unassigned: unassigned,
    p_include_excluded: !!includeExcluded,
    p_limit: limit,
    p_offset: Math.max(0, page) * limit,
  });
  if (error) throw error;
  return {
    rows: (data?.rows || []).map(r => ({
      phone: r.phone,
      storeName: r.primary_store || '',
      storeNames: r.store_names || [],
      storeCount: Number(r.store_count) || 1,
      totalShipments: Number(r.total_shipments) || 0,
      lastShipment: r.last_shipment,
      daysSinceLast: r.days_since_last == null ? null : Number(r.days_since_last),
      wallet: Number(r.wallet) || 0,
      lastTopup: r.last_topup,
      createdAt: r.created_at,
      integrationType: r.integration_type,
      billingType: r.billing_type,
      profileDone: !!r.profile_done,
      verified: !!r.verified,
      segment: r.segment,
      priority: r.priority || 'none',
      channel: r.channel,
      highValue: !!r.high_value,
      // المتابعة
      status: r.fu_status || 'new',
      ownerId: r.fu_owner || null,
      ownerName: r.owner_name || null,
      nextActionAt: r.next_action_at || null,
      notes: r.fu_notes || null,
      lastTouchAt: r.last_touch_at || null,
    })),
    count: Number(data?.count) || 0,
    page, limit,
  };
}
