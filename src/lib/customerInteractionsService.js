// Customer interactions service — the CRM activity feed.
//
// One row per touchpoint with a customer. Reminders sent, promises
// to pay, calls made, free-text notes. Anyone on the team who opens
// the customer drill-down sees the full history so handovers
// between operators don't lose context.
//
// API:
//   listInteractions({ customerName, storeId, limit })
//     → [{ id, customer_name, store_id, kind, note, due_date,
//          created_by_name, created_at }]
//
//   addInteraction({ customerName, storeId, kind, note, dueDate,
//                    userId, userName })
//     → the inserted row
//
//   deleteInteraction(id)
//     → { ok: true }
//
//   countByCustomer({ customerName, storeId })
//     → number (used to badge the drill-down before opening)
//
// All identifiers are OR-matched: lookup by customer_name AND
// store_id when both are known catches every entry that referenced
// either, so a customer who was originally tagged by name still
// surfaces after auto-link assigns them a store_id.

import { supabase } from './supabase.js';

const KIND_META = {
  reminder_sent:  { label: 'تذكير', color: '#3B82F6' },
  promise_to_pay: { label: 'وعد دفع',  color: '#F59E0B' },
  call_made:      { label: 'مكالمة', color: '#10B981' },
  note:           { label: 'ملاحظة', color: '#71717A' },
  visit:          { label: 'زيارة', color: '#8B5CF6' },
};

export function interactionKindMeta(kind) {
  return KIND_META[kind] || { label: kind, color: '#71717A' };
}

export async function listInteractions({ customerName = null, storeId = null, limit = 50 } = {}) {
  if (!customerName && !storeId) return [];
  let q = supabase
    .from('customer_interactions')
    .select('id, customer_name, store_id, kind, note, due_date, created_by, created_by_name, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (customerName && storeId) {
    q = q.or(`customer_name.eq.${escapeOrValue(customerName)},store_id.eq.${escapeOrValue(storeId)}`);
  } else if (customerName) {
    q = q.eq('customer_name', customerName);
  } else {
    q = q.eq('store_id', storeId);
  }

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// Helper: PostgREST .or() filter values can't contain commas / parens
// unescaped — we wrap in quotes to be safe.
function escapeOrValue(v) {
  if (v == null) return 'null';
  const s = String(v).replace(/"/g, '\\"');
  return `"${s}"`;
}

export async function addInteraction({
  customerName = null, storeId = null,
  kind, note = null, dueDate = null,
  userId = null, userName = null,
}) {
  if (!customerName && !storeId) throw new Error('customer_name أو store_id مطلوب');
  if (!kind) throw new Error('kind مطلوب');
  const row = {
    customer_name:    customerName,
    store_id:         storeId,
    kind,
    note:             note?.trim() || null,
    due_date:         dueDate || null,
    created_by:       userId,
    created_by_name:  userName,
  };
  const { data, error } = await supabase
    .from('customer_interactions')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteInteraction(id) {
  if (!id) throw new Error('id مطلوب');
  const { error, data } = await supabase
    .from('customer_interactions')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('لم يتم الحذف — قد لا تملك الصلاحية');
  return { ok: true };
}

// Lightweight aggregate — last-interaction timestamp keyed by both
// customer_name and store_id. Lets list views badge the entries
// with "آخر تواصل قبل Xي" without opening the drill-down.
export async function loadLastInteractionMap() {
  const { data, error } = await supabase
    .from('customer_interactions')
    .select('customer_name, store_id, kind, due_date, created_at')
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) throw error;
  const byCustomer = new Map();
  const byStore = new Map();
  for (const r of data || []) {
    if (r.customer_name && !byCustomer.has(r.customer_name)) byCustomer.set(r.customer_name, r);
    if (r.store_id && !byStore.has(r.store_id))                byStore.set(r.store_id, r);
  }
  return { byCustomer, byStore };
}
