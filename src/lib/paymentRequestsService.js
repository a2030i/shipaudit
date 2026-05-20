// Payment-request service.
//
// Two surfaces:
//   • Customer-facing portal — anon visitors call portalLookup(phone)
//     to see their stores + open invoices, then submit a payment
//     intent via submitPaymentRequest(...).
//   • Admin/accountant — listPaymentRequests / updatePaymentRequest
//     to track the workflow (pending → contacted → paid/cancelled).
//
// The portal lookup runs as a SECURITY DEFINER Postgres function so
// it can read across merchants + customer_receivables +
// customer_merchant_links without exposing them to anon globally.

import { supabase } from './supabase.js';

// ── Portal (anon-callable) ─────────────────────────────────────
export async function portalLookup(phone) {
  if (!phone) return { phone: null, stores: [] };
  const { data, error } = await supabase.rpc('portal_lookup', { p_phone: phone });
  if (error) throw error;
  return data || { phone: null, stores: [] };
}

export async function submitPaymentRequest({
  phone, customerName, storeId, storeName,
  amountTotal, invoiceCount, invoiceRefs, notes,
}) {
  if (!phone) throw new Error('phone مطلوب');
  if (!amountTotal || amountTotal <= 0) throw new Error('المبلغ مطلوب');
  const { data, error } = await supabase
    .from('payment_requests')
    .insert({
      phone,
      customer_name: customerName || null,
      store_id:      storeId || null,
      store_name:    storeName || null,
      amount_total:  Number(amountTotal),
      invoice_count: Number(invoiceCount) || 0,
      invoice_refs:  invoiceRefs || [],
      notes:         notes?.trim() || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Admin ──────────────────────────────────────────────────────
export async function listPaymentRequests({ status = null, limit = 200 } = {}) {
  let q = supabase
    .from('payment_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function updatePaymentRequest(id, { status, adminNotes, userId, userName }) {
  if (!id) throw new Error('id مطلوب');
  const patch = {};
  if (status) patch.status = status;
  if (adminNotes !== undefined) patch.admin_notes = adminNotes;
  // Stamp handler info on any transition out of 'pending'
  if (status && status !== 'pending') {
    patch.handled_by      = userId || null;
    patch.handled_by_name = userName || null;
    patch.handled_at      = new Date().toISOString();
  }
  const { data, error } = await supabase
    .from('payment_requests')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deletePaymentRequest(id) {
  if (!id) throw new Error('id مطلوب');
  const { error, data } = await supabase
    .from('payment_requests')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('لم يتم الحذف — قد لا تملك الصلاحية');
  return { ok: true };
}

export const STATUS_META = {
  pending:    { label: 'في الانتظار', color: '#F59E0B' },
  contacted:  { label: 'تم التواصل',  color: '#3B82F6' },
  paid:       { label: 'تم السداد',   color: '#10B981' },
  cancelled:  { label: 'ملغي',        color: '#71717A' },
};
