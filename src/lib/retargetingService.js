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

export function segmentMeta(k)  { return SEGMENTS[k]   || { label: k, color: 'var(--muted)', icon: '•' }; }
export function priorityMeta(k) { return PRIORITIES[k] || { label: k, color: 'var(--muted)' }; }

// الداشبورد: ملخّص + توزيعات + التقاط التغيّر (الحالي مقابل الرفعة السابقة).
export async function loadRetargetingDashboard() {
  const [sumRes, changeRes] = await Promise.all([
    supabase.rpc('crm_retargeting_summary'),
    supabase.rpc('capture_retargeting_summary').catch(() => ({ data: null })),
  ]);
  if (sumRes.error) throw sumRes.error;
  const s = sumRes.data || {};
  const change = changeRes?.data || {};
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
  hasBalance = null, q = null, page = 0, limit = 50,
} = {}) {
  const { data, error } = await supabase.rpc('crm_retargeting_leads', {
    p_segment: segment || null,
    p_priority: priority || null,
    p_integration: integration || null,
    p_billing: billing || null,
    p_has_balance: hasBalance,
    p_q: q || null,
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
    })),
    count: Number(data?.count) || 0,
    page, limit,
  };
}
