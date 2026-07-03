// webhook_events service — read + manually classify + retry.
//
// API:
//   loadWebhookEvents({ limit, status })  → recent events
//   assignEventToCarrier(eventId, carrierId, { learnSignature, userId })
//                                          → manual classification +
//                                            optionally save the
//                                            sender/filename as a new
//                                            signature for next time
//   markEventProcessed(eventId, auditId)  → after the UI converts the
//                                            file into an audit
//   downloadEventFile(event)              → fetch from storage
//   loadStorageFileAsBlob(path)           → util for the "audit this
//                                            file" flow

import { supabase } from './supabase.js';

export async function loadWebhookEvents({ limit = 100, status } = {}) {
  let q = supabase
    .from('webhook_events')
    .select(`
      id, received_at, source, sender, subject,
      file_name, file_size, file_hash, file_path,
      detected_carrier_id, detection_method, detection_confidence,
      status, audit_id, error_message, metadata, processed_at, processed_by, created_at
    `)
    .order('received_at', { ascending: false })
    .limit(limit);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function countByStatus() {
  const { data, error } = await supabase
    .from('webhook_events')
    .select('status');
  if (error) throw error;
  const counts = { pending: 0, processing: 0, processed: 0, failed: 0, awaiting_assignment: 0 };
  for (const r of data || []) counts[r.status] = (counts[r.status] || 0) + 1;
  return counts;
}

// Manual carrier assignment. Optionally augments the carrier's
// file_signature with the sender + a filename pattern derived from
// this event, so the NEXT file from the same source identifies
// automatically.
export async function assignEventToCarrier(eventId, carrierId, { learnSignature = true, userId } = {}) {
  // 1. Update event
  const { data: ev, error: e1 } = await supabase
    .from('webhook_events')
    .update({
      detected_carrier_id: carrierId,
      detection_method:    'manual',
      detection_confidence: 1.0,
      status:               'awaiting_assignment', // stays in UI as "ready to audit"
      processed_by:         userId || null,
    })
    .eq('id', eventId)
    .select()
    .single();
  if (e1) throw e1;

  // 2. Learn signature (best-effort; ignore failure so the assignment
  // still wins even if the carrier row mutated)
  if (learnSignature && (ev.sender || ev.file_name)) {
    try {
      const { data: carrier } = await supabase
        .from('carriers')
        .select('file_signature')
        .eq('id', carrierId)
        .single();
      const sig = carrier?.file_signature || {};
      const senders   = new Set(sig.email_from || []);
      if (ev.sender) senders.add(ev.sender);
      // Build a generous filename pattern: keep the alphabetical
      // prefix that's likely to recur, replace digits with `\d+`.
      // e.g. "EX712494.xlsx" → "^EX\\d+\\.xlsx?$"
      let pattern = sig.filename_pattern;
      if (!pattern && ev.file_name) {
        const trimmed = ev.file_name.replace(/^.*[\\/]/, '');
        const generic = trimmed
          .replace(/\d+/g, '\\d+')
          .replace(/[.]/g, '\\.');
        pattern = `^${generic.replace(/xlsx?$/i, 'xlsx?$').replace(/\\\.xlsx\?\$$/, '\\.xlsx?$')}`;
      }
      const newSig = {
        ...sig,
        email_from: Array.from(senders),
        filename_pattern: pattern,
        auto_learn: true,
      };
      await supabase
        .from('carriers')
        .update({ file_signature: newSig })
        .eq('id', carrierId);
    } catch { /* non-fatal */ }
  }
  return ev;
}

export async function markEventProcessed(eventId, auditId, userId) {
  const { data, error } = await supabase
    .from('webhook_events')
    .update({
      status:       'processed',
      audit_id:     auditId,
      processed_at: new Date().toISOString(),
      processed_by: userId || null,
    })
    .eq('id', eventId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function markEventFailed(eventId, error_message) {
  const { data, error } = await supabase
    .from('webhook_events')
    .update({ status: 'failed', error_message: String(error_message || '').slice(0, 500) })
    .eq('id', eventId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Permanently delete a webhook event. Also removes the stored file
// from the webhook-uploads bucket so we don't leave orphans behind.
// Best-effort on the storage cleanup — if it fails (file already
// gone, perms, etc.) we still delete the DB row.
//
// Uses .select() after the delete so an RLS silent-no-op (policy
// missing, denied) surfaces as an actual error instead of pretending
// it worked.
export async function deleteWebhookEvent(event) {
  const id = typeof event === 'string' ? event : event?.id;
  if (!id) throw new Error('event id مفقود');
  const path = typeof event === 'object' ? event?.file_path : null;
  if (path) {
    try {
      await supabase.storage.from('webhook-uploads').remove([path]);
    } catch { /* non-fatal */ }
  }
  const { data, error } = await supabase
    .from('webhook_events')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('لم يُحذف أي صف — تأكّد من صلاحيات RLS أو من وجود الحدث.');
  }
  return data.length;
}

// Bulk delete — same logic, in one round-trip per file + one DB call.
export async function deleteWebhookEvents(events) {
  const list = (events || []).filter(Boolean);
  if (!list.length) return 0;
  const paths = list.map(e => e.file_path).filter(Boolean);
  if (paths.length) {
    try { await supabase.storage.from('webhook-uploads').remove(paths); }
    catch { /* non-fatal */ }
  }
  const ids = list.map(e => e.id || e).filter(Boolean);
  const { data, error } = await supabase
    .from('webhook_events')
    .delete()
    .in('id', ids)
    .select('id');
  if (error) throw error;
  const deleted = data?.length ?? 0;
  if (deleted === 0) {
    throw new Error('لم يُحذف أي صف — تأكّد من صلاحيات RLS.');
  }
  return deleted;
}

export async function downloadEventFile(event) {
  if (!event?.file_path) throw new Error('الملف غير موجود في المخزن');
  const { data, error } = await supabase
    .storage
    .from('webhook-uploads')
    .download(event.file_path);
  if (error) throw error;
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = event.file_name || 'webhook-file.xlsx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Returns the file as a Blob for in-browser processing (audit pipeline).
export async function loadEventFileBlob(event) {
  if (!event?.file_path) throw new Error('الملف غير موجود في المخزن');
  const { data, error } = await supabase
    .storage
    .from('webhook-uploads')
    .download(event.file_path);
  if (error) throw error;
  return data;
}

// «فواتير تنتظر نظرتك» — أحداث الوارد التي وصلت بنجاح لكن لم تُستورَد
// (لا مراجعة ولا تحصيل): processed_at IS NULL و audit_id IS NULL.
// تُغذّي بطاقة لوحة القرارات؛ العمر بالأيام يقود الاستعجال.
export async function loadInvoicesAwaitingReview({ limit = 50 } = {}) {
  const [{ data, error }, carriersRes] = await Promise.all([
    supabase.from('webhook_events')
      .select('id, received_at, sender, subject, file_name, detected_carrier_id')
      .is('processed_at', null)
      .is('audit_id', null)
      .neq('status', 'failed')
      .order('received_at', { ascending: true })
      .limit(limit),
    supabase.from('carriers').select('id, name'),
  ]);
  if (error) throw error;
  const nameById = new Map((carriersRes.data || []).map(c => [c.id, c.name]));
  const now = Date.now();
  return (data || []).map(e => ({
    id:          e.id,
    receivedAt:  e.received_at,
    ageDays:     Math.floor((now - new Date(e.received_at).getTime()) / 86400000),
    carrierId:   e.detected_carrier_id,
    carrierName: nameById.get(e.detected_carrier_id) || null,
    subject:     e.subject,
    fileName:    e.file_name,
  }));
}

// Construct the webhook endpoint URL for display in the UI (so the
// user knows what to point their automation at).
export function getWebhookEndpoint() {
  // Vite injects VITE_SUPABASE_URL when available; fall back to the
  // hardcoded project URL used elsewhere in the app.
  const base = 'https://pubtkfwmznfmffavyzsy.supabase.co';
  return `${base}/functions/v1/webhook-intake`;
}
