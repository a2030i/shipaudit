// خدمة داشبورد إعادة استهداف العملاء (المرحلة 2) — تقرأ محرّك التصنيف
// (v_crm_retargeting) عبر RPCs: ملخّص + فرص مفلترة مُرقّمة + التقاط التغيّر
// بين رفعات ملف المتاجر. المصدر = أحدث snapshot للمتاجر (stores.xlsx).
import { supabase } from './supabase.js';

// ── داشبورد تنشيط المتاجر (2026-07-21) ──────────────────────────────
// اتجاه «المتاجر النشطة» (آخر شحنة ≤N يوم) عبر لقطات كشف المتاجر مقابل هدف
// ثابت — لقياس أثر فريق المبيعات. الهدف في app_settings['store_activation'].
const ACTIVATION_KEY = 'store_activation';
export const ACTIVATION_DEFAULT = { target: 500, days: 5 };

export async function loadActivationConfig() {
  const { data } = await supabase.from('app_settings').select('value').eq('key', ACTIVATION_KEY).maybeSingle();
  if (!data?.value) return { ...ACTIVATION_DEFAULT };
  try { const v = JSON.parse(data.value); return { target: Number(v.target) || 500, days: Number(v.days) || 5 }; }
  catch { return { ...ACTIVATION_DEFAULT }; }
}
export async function saveActivationConfig({ target, days }) {
  const value = JSON.stringify({ target: Math.max(1, Math.round(Number(target) || 500)), days: Math.max(1, Math.round(Number(days) || 5)) });
  const { error } = await supabase.from('app_settings')
    .upsert({ key: ACTIVATION_KEY, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}
export async function loadStoreActivationTrend(days = 5, limit = 24) {
  const { data, error } = await supabase.rpc('store_activation_trend', { p_days: days, p_limit: limit });
  if (error || !Array.isArray(data)) return [];
  return data.map(r => ({
    snapDate: r.snap_date, uploadedAt: r.uploaded_at,
    total: Number(r.total_stores) || 0, active: Number(r.active_stores) || 0,
    active30: Number(r.active_30d) || 0,
    prepaid: Number(r.prepaid_active) || 0, postpaid: Number(r.postpaid_active) || 0,
  }));
}

// تسميات وألوان الشرائح/الأولوية/القناة — نقطة الحقيقة الواحدة للعرض.
export const SEGMENTS = {
  new_active:        { label: 'جديد نشط',            color: 'var(--accent3)', icon: '🆕' },
  topped_no_ship:    { label: 'شحن رصيد ولم يشحن',   color: 'var(--gold)', icon: '💳' },
  linked_no_ship:    { label: 'ربط ولم يشحن',        color: 'var(--accent)', icon: '🔌' },
  registered_no_ship:{ label: 'سجّل ولم يشحن',       color: 'var(--muted)', icon: '📝' },
  stopped_recent:    { label: 'توقّف حديثاً',         color: 'var(--brand-navy)', icon: '⏸️' },
  stopped_long:      { label: 'توقّف قديماً',         color: '#B91C1C', icon: '🕰️' },
  active:            { label: 'نشط',                 color: 'var(--green)', icon: '✅' },
  negative_balance:  { label: 'رصيد سالب',           color: 'var(--red)', icon: '🛑' },
};
export const PRIORITIES = {
  A:    { label: 'A — اتصال شخصي', color: 'var(--red)' },
  B:    { label: 'B — واتساب',     color: 'var(--accent3)' },
  C:    { label: 'C — تفعيل',      color: 'var(--gold)' },
  D:    { label: 'D — حملة عامة',  color: 'var(--muted)' },
  FIN:  { label: 'مالية',          color: 'var(--accent)' },
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
  contacted:         { label: 'تم التواصل',    color: 'var(--accent3)' },
  whatsapp_sent:     { label: 'أُرسل واتساب',   color: 'var(--brand)' },
  no_answer:         { label: 'لم يرد',        color: 'var(--gold)' },
  interested:        { label: 'مهتم',          color: 'var(--green)' },
  needs_followup:    { label: 'يحتاج متابعة',  color: 'var(--brand-navy)' },
  returned:          { label: 'عاد للشحن',     color: '#16A34A' },
  not_interested:    { label: 'غير مهتم',      color: 'var(--muted2)' },
  price_issue:       { label: 'مشكلة سعر',     color: '#EF4444' },
  support_issue:     { label: 'مشكلة دعم',     color: '#EF4444' },
  integration_issue: { label: 'مشكلة ربط',     color: '#EF4444' },
  competitor:        { label: 'انتقل لمنافس',  color: '#B91C1C' },
  closed_business:   { label: 'توقّف نشاطه',    color: '#B91C1C' },
  finance:           { label: 'تسوية مالية',   color: 'var(--accent)' },
  // توحيد المتابعة (§1.32 تكملة): حالات «فرص من هاتف» انضمّت للمفردات الموحّدة —
  // نظام متابعة واحد (retargeting_followups) لكل تبويبات مركز المبيعات.
  converted:         { label: '✅ تحوّل لعميل',  color: '#16A34A' },
  // حالات الاستبعاد الدائم — تُخفَى من القوائم افتراضياً (لا يُكلَّمون)
  supplier:          { label: '📦 مورد/شريك',   color: 'var(--accent)', excluded: true },
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
  includeExcluded = false, campaign = null, page = 0, limit = 50,
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
    p_campaign: campaign || null,   // آخر حملة منذ: none|within7|within30|older30
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

// ── محرك المبيعات (§1.37) ────────────────────────────────────────────
// إسناد/ختم جماعي للمتابعات الموحّدة (يخدم إعادة الاستهداف + فرص هاتف)
export async function bulkSetFollowups(phones, { ownerId = null, status = null, touch = false } = {}) {
  if (!phones?.length) return 0;
  let total = 0;
  for (let i = 0; i < phones.length; i += 1000) {   // فخّ PostgREST-1000
    const { data, error } = await supabase.rpc('set_retargeting_followups_bulk', {
      p_phones: phones.slice(i, i + 1000), p_owner: ownerId || null,
      p_status: status || null, p_touch: !!touch,
    });
    if (error) throw error;
    total += Number(data) || 0;
  }
  return total;
}

// «مهامي اليوم» — يوم موظف المبيعات في استدعاء واحد
export async function loadSalesToday(userId = null) {
  const { data, error } = await supabase.rpc('sales_today', { p_user: userId || null });
  if (error) throw error;
  return {
    dueFollowups: data?.due_followups || [],
    replies: data?.replies || [],
    myNewLeads: data?.my_new_leads || [],
    myNewLeadsCount: Number(data?.my_new_leads_count) || 0,
    myTasks: data?.my_tasks || [],
    myFollowupsTotal: Number(data?.my_followups_total) || 0,
  };
}

// معدل التحويل بالموظف — نقطة الحقيقة للوحة الأداء والأهداف
export async function loadSalesOwnerStats() {
  const { data, error } = await supabase.rpc('sales_owner_stats');
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(r => ({
    ownerId: r.owner_id, assigned: Number(r.assigned) || 0,
    worked: Number(r.worked) || 0, returned: Number(r.returned) || 0,
    conversionPct: Number(r.conversion_pct) || 0, touches7d: Number(r.touches_7d) || 0,
  }));
}

// جدولة حملة (طابور campaign_queue — ينفّذها campaign-runner كل 15 دقيقة)
export async function scheduleCampaign({ scheduledAt, templateName, recipients, bucketLabel, userId }) {
  // تقسيم 100/صف طابور (2026-07-21): مهلة campaign-runner ~150ث والقياس الفعلي
  // ≈ 1.1ث/رسالة — صف 100 ≈ 110ث يسع بأمان (150 سابقاً كان يلامس المهلة).
  const CHUNK = 100;
  const rows = [];
  for (let i = 0; i < recipients.length; i += CHUNK) {
    rows.push({
      scheduled_at: scheduledAt, template_name: templateName,
      recipients: recipients.slice(i, i + CHUNK),
      bucket_label: bucketLabel || null, created_by: userId || null,
    });
  }
  const { error } = await supabase.from('campaign_queue').insert(rows);
  if (error) throw error;
  return rows.length;
}
