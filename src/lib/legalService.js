// التصعيد القانوني — يجمع إشارتين للتحويل الفوري للقانونية:
//  (١) عملاء تجاوزت فواتيرهم 90 يوماً (المصدر: فواتير زوهو المفتوحة).
//  (٢) متاجر «دفع مسبق» برصيد محفظة سالب (المصدر: كشف المنصّة/merchants).
// + إجماليات الأعمار مقابل أهداف ثابتة (31–60 ≤ 50ألف · 61–90 ≤ 25ألف · 91+ = 0).
// كله من RPC واحد legal_escalation_dashboard() يقرأ المرآة المحلية.
import { supabase } from './supabase.js';

export async function loadLegalDashboard() {
  const { data, error } = await supabase.rpc('legal_escalation_dashboard');
  if (error) throw error;
  const d = data || {};
  const a = d.aging || {};
  return {
    aging: {
      b31_60: Number(a.b31_60) || 0, b61_90: Number(a.b61_90) || 0, b90plus: Number(a.b90plus) || 0,
      t31_60: Number(a.target_31_60) || 50000, t61_90: Number(a.target_61_90) || 25000, t90plus: Number(a.target_90plus) || 0,
    },
    overdue90: (Array.isArray(d.overdue90) ? d.overdue90 : []).map(r => ({
      name: r.name, storeName: r.store_name || '', phone: r.phone || '',
      amount90: Number(r.amount_90) || 0, totalOpen: Number(r.total_open) || 0,
      oldestDays: Number(r.oldest_days) || 0, invCnt: Number(r.inv_cnt) || 0,
    })),
    prepaidNegative: (Array.isArray(d.prepaid_negative) ? d.prepaid_negative : []).map(r => ({
      storeId: r.store_id, storeName: r.store_name || '', phone: r.phone || '',
      wallet: Number(r.wallet) || 0, status: r.status || '', lastShipmentAt: r.last_shipment_at || null,
    })),
  };
}
