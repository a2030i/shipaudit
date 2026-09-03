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

// مركز قيادة هدف العملاء النشطين. العدّ هنا على رقم العميل الموحّد، لا صف المتجر؛
// ويجمع حركة الدخول/الخروج، دين المتابعة، والنتائج الموضوعية من Snapshot المنصة.
export async function loadCustomerActivationCommandCenter(days = 5, target = 500, limit = 24) {
  const { data, error } = await supabase.rpc('customer_activation_command_center', {
    p_days: days,
    p_target: target,
    p_limit: limit,
  });
  if (error) throw error;
  const value = data || {};
  return {
    current: value.current || {},
    movement: value.movement || {},
    execution: value.execution || {},
    outcomes30d: value.outcomes_30d || {},
    sync: value.sync || {},
    trend: Array.isArray(value.trend) ? value.trend.map(row => ({
      snapshotId: row.snapshot_id,
      snapDate: row.snapshot_date,
      uploadedAt: row.uploaded_at,
      totalCustomers: Number(row.total_customers) || 0,
      totalStores: Number(row.total_stores) || 0,
      active: Number(row.active) || 0,
      active30: Number(row.active_30d) || 0,
      prepaid: Number(row.prepaid_active) || 0,
      postpaid: Number(row.postpaid_active) || 0,
    })) : [],
  };
}

// نبض المتاجر: مقارنة أحدث لقطة مجدولة بالمرجع اليومي السابق.
// لا يشتق حالة الحساب من النشاط؛ inactive/غير نشط فقط يعني موقوفًا.
export async function loadLamhaStorePerformance({
  filter = 'all', search = null, page = 0, limit = 25,
} = {}) {
  const { data, error } = await supabase.rpc('lamha_store_performance_command_center', {
    p_filter: filter || 'all',
    p_search: search || null,
    p_limit: limit,
    p_offset: Math.max(0, page) * limit,
  });
  if (error) throw error;
  const value = data || {};
  return {
    metric: value.metric || {},
    summary: value.summary || {},
    activeFilter: value.active_filter || filter || 'all',
    count: Number(value.count) || 0,
    rows: Array.isArray(value.rows) ? value.rows.map(row => ({
      storeId: row.store_id,
      storeName: row.store_name || '',
      phone: row.phone || '',
      shipmentCount: Number(row.shipment_count) || 0,
      shipmentDelta: Number(row.shipment_delta) || 0,
      negativeShipmentDelta: Number(row.negative_shipment_delta) || 0,
      lastShipmentAt: row.last_shipment_at || null,
      daysSinceLast: row.days_since_last == null ? null : Number(row.days_since_last),
      accountState: row.account_state || 'unknown',
      rawStatus: row.raw_status || null,
      activityState: row.activity_state || 'never_shipped',
      lifecycleStage: row.lifecycle_stage || 'never_shipped',
      billingType: row.billing_type || null,
      integrationType: row.integration_type || null,
      walletBalance: row.wallet_balance == null ? null : Number(row.wallet_balance),
      createdAt: row.created_at_platform || null,
      registeredToday: !!row.registered_today,
      observedToday: !!row.observed_today,
      firstShipment: !!row.first_shipment,
      resumed: !!row.resumed,
      disabledToday: !!row.disabled_today,
      enabledToday: !!row.enabled_today,
    })) : [],
    trend: Array.isArray(value.trend) ? value.trend.map(row => ({
      date: row.date,
      at: row.at,
      source: row.source,
      shipments: Number(row.shipments) || 0,
      shippingStores: Number(row.shipping_stores) || 0,
      counterExceptions: Number(row.counter_exceptions) || 0,
    })) : [],
  };
}

// يقرأ مجموعة نبض لمحة كاملة لإسناد قائمة المبيعات، لا الصفحة المرئية فقط.
// تبقى الكتابة في assign_platform_sales_accounts وبحاجز الصلاحية والتدقيق الحاليين.
export async function loadAllLamhaStorePerformanceRows(filters = {}, { maxRows = 5000 } = {}) {
  const pageSize = 100;
  const rows = [];
  let page = 0;
  let count = 0;
  do {
    const result = await loadLamhaStorePerformance({ ...filters, page, limit: pageSize });
    count = result.count;
    rows.push(...result.rows);
    page += 1;
    if (!result.rows.length) break;
  } while (rows.length < count && rows.length < maxRows);
  return { rows: rows.slice(0, maxRows), count };
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
  // الإشارات الإضافية RPC مستقل كي يبقى sales_today المستقر بلا استبدال.
  // كلا الاستدعاءين thenables تحل إلى {data,error}؛ فشل الإثراء غير قاتل
  // أثناء النشر المتدرّج، بينما فشل قائمة اليوم نفسها يظل خطأً صريحاً.
  const [todayRes, signalsRes] = await Promise.all([
    supabase.rpc('sales_today_routed', { p_user: userId || null }),
    supabase.rpc('platform_commercial_signals'),
  ]);
  if (todayRes.error) throw todayRes.error;
  const data = todayRes.data || {};
  const signals = signalsRes?.error ? {} : (signalsRes?.data || {});
  if (signalsRes?.error) console.info('Merchant sales signals unavailable:', signalsRes.error.message);
  const detailsByPhone = new Map(
    (signals.opportunity_details || []).map(row => [row.phone, row]),
  );
  const platformOpportunities = (data.platform_opportunities || []).map(row => ({
    ...row,
    ...(detailsByPhone.get(row.phone) || {}),
  }));
  return {
    dueFollowups: data?.due_followups || [],
    platformOpportunities,
    platformOpportunityCount: Number(data?.platform_opportunity_count) || 0,
    platformSummary: signals.summary || {},
    activationReady: signals.activation_ready || [],
    activationReadyCount: Number(signals.activation_ready_count) || 0,
    leadActions: data?.lead_actions || [],
    myNewLeads: data?.my_new_leads || [],
    myNewLeadsCount: Number(data?.my_new_leads_count) || 0,
    unassignedInbound: data?.unassigned_inbound || [],
    myTasks: data?.my_tasks || [],
    myFollowupsTotal: Number(data?.my_followups_total) || 0,
  };
}

// استلام ذري لفرصة منصة ووضعها مباشرةً في قائمة اليوم. لا نستخدم
// set_retargeting_followup هنا لأن upsert العام قد يعيد إسناد فرصة سبق أن
// استلمها موظف آخر، كما أن الاستلام بلا موعد يصنع Backlog غير قابل للإدارة.
export async function claimPlatformSalesOpportunity(phone, nextAt = new Date().toISOString()) {
  const { data, error } = await supabase.rpc('claim_platform_sales_opportunity', {
    p_phone: String(phone || ''),
    p_next: nextAt,
  });
  if (error) throw error;
  return data;
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

// ── CRM متاجر المنصّة (2026-07-31) ──────────────────────────────────
// الحالة التشغيلية مشتقة من ملف المتاجر، ومرحلة البيع/الموعد/الملاحظات
// من retargeting_followups. لا تستورد ردود هاتف ولا تنشئ Lead منها.
export async function loadPlatformSalesPipeline({
  bucket = 'hot_live_new', ownerId = null, unassigned = false,
  workFilter = 'all', sort = 'recommended',
  search = null, page = 0, limit = 50,
} = {}) {
  const { data, error } = await supabase.rpc('platform_commercial_pipeline_v2', {
    p_bucket: bucket || 'all',
    p_work_filter: workFilter || 'all',
    p_sort: sort || 'recommended',
    p_owner: ownerId || null,
    p_unassigned: !!unassigned,
    p_search: search || null,
    p_limit: limit,
    p_offset: Math.max(0, page) * limit,
  });
  if (error) throw error;
  return {
    summary: data?.summary || {},
    workSummary: data?.work_summary || {},
    rows: Array.isArray(data?.rows) ? data.rows : [],
    count: Number(data?.count) || 0,
    page,
    limit,
  };
}

// Reads the complete filtered result set, not only the visible page. The RPC
// deliberately caps a page at 100 rows, so exports and bulk assignment page
// through it while preserving the exact filters selected by the operator.
export async function loadAllPlatformSalesPipelineRows(filters = {}, { maxRows = 5000 } = {}) {
  const pageSize = 100;
  const rows = [];
  let page = 0;
  let count = 0;

  do {
    const result = await loadPlatformSalesPipeline({
      ...filters,
      page,
      limit: pageSize,
    });
    count = Number(result.count) || 0;
    rows.push(...result.rows);
    page += 1;
    if (count > maxRows) throw new Error(`عدد النتائج يتجاوز الحد الآمن (${maxRows}). ضيّق الفلتر ثم أعد المحاولة.`);
  } while (rows.length < count && rows.length < maxRows);

  return { rows, count };
}

export async function assignPlatformSalesAccounts(phones, ownerId) {
  const uniquePhones = [...new Set((phones || []).map(phone => String(phone || '').trim()).filter(Boolean))];
  if (!uniquePhones.length) throw new Error('لا توجد نتائج لإسنادها');
  if (!ownerId) throw new Error('اختر الموظف المسؤول');
  const { data, error } = await supabase.rpc('assign_platform_sales_accounts', {
    p_phones: uniquePhones,
    p_owner: ownerId,
  });
  if (error) throw error;
  return data || {};
}

export async function loadPlatformSalesAccount(phone) {
  if (!phone) throw new Error('رقم العميل مطلوب');
  let { data, error } = await supabase.rpc('platform_commercial_account', {
    p_phone: String(phone),
  });
  if (error && /permission denied for view v_platform_commercial_routing/i.test(error.message || '')) {
    ({ data, error } = await supabase.rpc('platform_sales_account', {
      p_phone: String(phone),
    }));
  }
  if (error) throw error;
  return {
    account: data?.account || null,
    activities: Array.isArray(data?.activities) ? data.activities : [],
    lifecycle: Array.isArray(data?.lifecycle) ? data.lifecycle : [],
    statusChanges: Array.isArray(data?.status_changes) ? data.status_changes : [],
  };
}

export async function recordPlatformSalesActivity({
  phone,
  stage = null,
  outcome = null,
  activityType = 'note',
  nextAt = null,
  nextType = 'call',
  note = null,
  ownerId = null,
  lossReason = null,
  touch = false,
} = {}) {
  if (!phone) throw new Error('رقم العميل مطلوب');
  const { data, error } = await supabase.rpc('record_platform_sales_activity', {
    p_phone: String(phone),
    p_stage: stage || null,
    p_outcome: outcome || null,
    p_activity_type: activityType || 'note',
    p_next: nextAt || null,
    p_next_type: nextType || 'call',
    p_note: note || null,
    p_owner: ownerId || null,
    p_loss_reason: lossReason || null,
    p_touch: !!touch,
  });
  if (error) throw error;
  return data;
}

// جدولة حملة (طابور campaign_queue — ينفّذها campaign-runner كل 15 دقيقة)
export async function scheduleCampaign({
  scheduledAt,
  templateName,
  recipients,
  bucketLabel,
  userId,
  assignedHatifUserId = null,
  assignedHatifUserName = null,
}) {
  // تقسيم 100/صف طابور (2026-07-21): مهلة campaign-runner ~150ث والقياس الفعلي
  // ≈ 1.1ث/رسالة — صف 100 ≈ 110ث يسع بأمان (150 سابقاً كان يلامس المهلة).
  const CHUNK = 100;
  const rows = [];
  for (let i = 0; i < recipients.length; i += CHUNK) {
    rows.push({
      scheduled_at: scheduledAt, template_name: templateName,
      recipients: recipients.slice(i, i + CHUNK),
      bucket_label: bucketLabel || null, created_by: userId || null,
      assigned_hatif_user_id: assignedHatifUserId || null,
      assigned_hatif_user_name: assignedHatifUserName || null,
    });
  }
  const { error } = await supabase.from('campaign_queue').insert(rows);
  if (error) throw error;
  return rows.length;
}
