// شاشة الفعل التالي (Next Best Action) — أقوى ما يميّز مركز العمليات عن هاتف:
// يربط التواصل (ردّ حملة) بالمال (دين/محفظة) والشحن (توقّف) في قائمة إجراءات
// مرتّبة لكل عميل، مع سبب واضح وإجراء مقترح. المصدر RPC next_best_actions.
import { supabase } from './supabase.js';

// وصف كل نوع إشارة — أيقونة/لون/مجموعة الإجراء (نقطة الحقيقة للعرض).
export const NBA_META = {
  reply:      { icon: '↩️', label: 'ردّ لم يُتابَع', color: '#0EA5E9', group: 'تواصل' },
  wallet_neg: { icon: '👛', label: 'محفظة سالبة', color: 'var(--red)', group: 'تحصيل' },
  debt:       { icon: '💰', label: 'دين مفتوح', color: 'var(--red)', group: 'تحصيل' },
  stopped:    { icon: '😴', label: 'توقّف عن الشحن', color: 'var(--gold)', group: 'مبيعات' },
};

export async function loadNextBestActions({ owner = null, limit = 300 } = {}) {
  const { data, error } = await supabase.rpc('next_best_actions', { p_limit: limit, p_owner: owner });
  if (error) throw error;
  return (data || []).map(r => ({
    phone: r.phone,
    name: r.name || r.phone,
    storeId: r.store_id,
    ownerId: r.owner_id,
    reasonCode: r.reason_code,
    reason: r.reason,
    action: r.action,
    priority: Number(r.priority) || 0,
    amount: r.amount == null ? null : Number(r.amount),
    followupStatus: r.followup_status,
    lastTouch: r.last_touch,
  }));
}
