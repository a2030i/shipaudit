// Bad-debt write-off service.
//
// Two-step workflow:
//   1. Collections operator submits a write-off request with amount
//      + reason. Stays in 'pending' until reviewed.
//   2. Admin reviews and either approves (the amount becomes a
//      virtual reduction on the customer's balance in the
//      receivables view) or rejects (with a reason that goes in
//      the audit trail).
//
// The receivables snapshot itself is never modified — write-offs
// live in their own table and the loader subtracts the approved
// total per customer when computing the displayed balance. This
// preserves the original financial-export integrity.

import { supabase } from './supabase.js';

export const WRITEOFF_STATUS_LABELS = {
  pending:   'بانتظار الموافقة',
  approved:  'مُعتمَد',
  rejected:  'مرفوض',
};

export async function requestWriteoff({ customerName, amount, reason, taskId = null, userId = null }) {
  if (!customerName?.trim()) throw new Error('اسم العميل مطلوب');
  if (!(Number(amount) > 0)) throw new Error('المبلغ يجب أن يكون أكبر من صفر');
  if (!reason?.trim())       throw new Error('السبب مطلوب');
  const { data, error } = await supabase
    .from('bad_debt_writeoffs')
    .insert({
      customer_name: customerName.trim(),
      amount:        Number(amount),
      reason:        reason.trim(),
      task_id:       taskId,
      status:        'pending',
      requested_by:  userId,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function approveWriteoff(id, { note = null, userId = null } = {}) {
  if (!id) throw new Error('id مطلوب');
  const { data, error } = await supabase
    .from('bad_debt_writeoffs')
    .update({
      status:      'approved',
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      review_note: note?.trim() || null,
    })
    .eq('id', id)
    .eq('status', 'pending')      // can't approve a non-pending row
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function rejectWriteoff(id, { reason, userId = null }) {
  if (!id) throw new Error('id مطلوب');
  if (!reason?.trim()) throw new Error('سبب الرفض مطلوب');
  const { data, error } = await supabase
    .from('bad_debt_writeoffs')
    .update({
      status:      'rejected',
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      review_note: reason.trim(),
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listWriteoffs({ status = null, customer = null } = {}) {
  let q = supabase
    .from('bad_debt_writeoffs')
    .select('*')
    .order('requested_at', { ascending: false });
  if (status)   q = q.eq('status', status);
  if (customer) q = q.eq('customer_name', customer);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// Per-customer approved total — used by the receivables loader to
// show the effective balance.
export async function loadApprovedWriteoffsByCustomer() {
  const { data, error } = await supabase.rpc('approved_writeoffs_by_customer');
  if (error) throw error;
  const map = new Map();
  for (const r of (data || [])) {
    map.set(r.customer_name, Number(r.total_written_off) || 0);
  }
  return map;
}

export async function deleteWriteoff(id) {
  // Only pending entries can be deleted (admin can withdraw their
  // own request). Approved/rejected rows stay forever for audit.
  if (!id) throw new Error('id مطلوب');
  const { error, data } = await supabase
    .from('bad_debt_writeoffs')
    .delete()
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('غير قابل للحذف — إمّا أنه مُعتمَد أو مرفوض');
  return { ok: true };
}
