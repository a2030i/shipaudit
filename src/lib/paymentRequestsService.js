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

// ── Payment configuration (anon-callable read) ────────────────
// Reads the Moyasar publishable key from app_settings via the
// SECURITY DEFINER `get_payment_config` RPC. Cached in-memory for
// the page lifetime so the portal doesn't re-fetch on every render.
let _paymentConfigPromise = null;
export async function getPaymentConfig({ force = false } = {}) {
  if (!force && _paymentConfigPromise) return _paymentConfigPromise;
  _paymentConfigPromise = (async () => {
    try {
      const { data, error } = await supabase.rpc('get_payment_config');
      if (error) throw error;
      return {
        moyasarPublishableKey: data?.moyasar_publishable_key || '',
      };
    } catch (e) {
      console.info('[payment config] fetch failed:', e.message);
      return { moyasarPublishableKey: '' };
    }
  })();
  return _paymentConfigPromise;
}

// Admin-side setter — updates the app_settings row for the key.
// Authenticated users only (RLS on app_settings).
export async function setMoyasarPublishableKey(value) {
  const trimmed = (value || '').trim();
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: 'moyasar_publishable_key', value: trimmed, updated_at: new Date().toISOString() });
  if (error) throw error;
  _paymentConfigPromise = null;  // invalidate cache
  return { ok: true };
}

// ── Portal (anon-callable) ─────────────────────────────────────
export async function portalLookup(phone) {
  if (!phone) return { phone: null, stores: [] };
  const { data, error } = await supabase.rpc('portal_lookup', { p_phone: phone });
  if (error) throw error;
  return data || { phone: null, stores: [] };
}

// Attach a Moyasar payment_id to an existing request after the
// customer completes payment on the Moyasar hosted form. The RPC is
// anon-callable + SECURITY DEFINER, but only adds the payment hint —
// the admin still flips status='paid' manually after verifying in
// the Moyasar dashboard. Client-side success callbacks can be faked,
// so we don't trust them as a status authority.
export async function attachMoyasarPayment(requestId, paymentId, method = null) {
  if (!requestId || !paymentId) throw new Error('request_id و payment_id مطلوبان');
  const { data, error } = await supabase.rpc('attach_moyasar_payment', {
    p_request_id:     requestId,
    p_payment_id:     paymentId,
    p_payment_method: method,
  });
  if (error) throw error;
  return data || null;
}

export async function submitPaymentRequest({
  phone, customerName, storeId, storeName,
  amountTotal, invoiceCount, invoiceRefs, notes,
  paymentType, receiptPath, isPartial,
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
      payment_type:  paymentType || 'online',
      receipt_path:  receiptPath || null,
      is_partial:    !!isPartial,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Receipt upload — anon-allowed under storage.objects RLS. Returns
// { path, publicUrl } so the caller can attach the path to the
// payment_request row + display the URL in the admin.
export async function uploadReceipt(file) {
  if (!file) throw new Error('file مطلوب');
  const ext = (file.name?.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = Math.random().toString(36).slice(2, 10);
  const path = `${stamp}_${rand}.${ext}`;
  const { error } = await supabase.storage
    .from('payment-receipts')
    .upload(path, file, { contentType: file.type || 'application/octet-stream' });
  if (error) throw error;
  const { data } = supabase.storage.from('payment-receipts').getPublicUrl(path);
  return { path, publicUrl: data?.publicUrl || null };
}

// Build a public URL for an already-stored receipt path (used by the
// admin page to render the receipt link).
export function receiptUrl(path) {
  if (!path) return null;
  const { data } = supabase.storage.from('payment-receipts').getPublicUrl(path);
  return data?.publicUrl || null;
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
