// Zoho intake — operator-facing wrapper around the zoho_intake_events
// table the zoho-intake edge function fills.
//
// Public API:
//   listIntake({ status })      → events (pending by default)
//   processIntake(event, opts)  → downloads the file from storage,
//                                 runs the same uploadFile() flow as
//                                 the manual hub, marks event processed
//   dismissIntake(id, reason)   → soft-cancel (status='dismissed')
//   deleteIntake(id)            → hard delete (admin-only in practice)
//
// The edge function does the receive + auto-detect step. This service
// does the actual data ingestion when the operator confirms.

import { supabase } from './supabase.js';
import { uploadFile, UPLOAD_SOURCES } from './uploadsHubService.js';

const BUCKET = 'zoho-intake';

export const INTAKE_STATUS_LABELS = {
  pending:    'بانتظار المعالجة',
  processed:  'تمت معالجته',
  failed:     'فشل',
  dismissed:  'تم تجاهله',
};

export async function listIntake({ status = 'pending', limit = 100 } = {}) {
  let q = supabase
    .from('zoho_intake_events')
    .select('*')
    .order('received_at', { ascending: false })
    .limit(limit);
  if (status && status !== 'all') q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// Process a single intake event: download the stored file, hand it to
// uploadFile() with the matching source id. If the edge function
// couldn't auto-detect the source, the caller must supply an override
// via `opts.sourceOverride`.
export async function processIntake(event, { sourceOverride = null, userId = null } = {}) {
  if (!event?.file_path) throw new Error('الملف غير موجود في التخزين');
  const sourceId = sourceOverride || event.detected_source;
  if (!sourceId) throw new Error('نوع المصدر مطلوب — الكاشف ما حدّده');
  if (!UPLOAD_SOURCES.some(s => s.id === sourceId)) {
    throw new Error(`نوع غير معروف: ${sourceId}`);
  }

  // Download the file from storage into a Blob — uploadFile() takes
  // a File, but Blob is interface-compatible enough for the XLSX
  // arrayBuffer() path uploadFile uses internally. We attach the
  // original name explicitly.
  const { data: blob, error: dErr } = await supabase.storage.from(BUCKET).download(event.file_path);
  if (dErr || !blob) throw new Error(`فشل تحميل الملف: ${dErr?.message || 'unknown'}`);
  // Construct a File so size/name introspection works inside uploadFile
  const file = new File([blob], event.file_name, { type: blob.type || undefined });

  // Run the standard upload flow
  let result;
  try {
    result = await uploadFile({ sourceId, file, userId });
  } catch (e) {
    // Mark failed + propagate
    await supabase.from('zoho_intake_events').update({
      status:         'failed',
      processed_at:   new Date().toISOString(),
      processed_by:   userId || null,
      error_message:  e.message,
    }).eq('id', event.id);
    throw e;
  }

  // Mark processed with the result summary
  await supabase.from('zoho_intake_events').update({
    status:         'processed',
    processed_at:   new Date().toISOString(),
    processed_by:   userId || null,
    process_result: {
      sourceId,
      rowCount:  result.rowCount,
      matched:   result.matched,
      total:     result.total,
      message:   result.message,
    },
  }).eq('id', event.id);

  return { sourceId, ...result };
}

// Every Zoho source is a SNAPSHOT (latest wins) — so when several pending
// files of the same detected_source are queued, only the NEWEST matters.
// This auto-dismisses the older duplicates as 'superseded' so the inbox
// collapses to one-per-type and we never ingest a stale snapshot. Events
// whose source the detector couldn't resolve are left untouched (they
// still need a manual type pick). Returns the count superseded.
export async function supersedePendingIntake() {
  const pending = await listIntake({ status: 'pending' }); // received_at desc
  const seen = new Set();
  const stale = [];
  for (const ev of pending) {                 // newest first
    if (!ev.detected_source) continue;        // unknown type → leave for manual
    if (seen.has(ev.detected_source)) { stale.push(ev); continue; }
    seen.add(ev.detected_source);
  }
  for (const ev of stale) {
    await supabase.from('zoho_intake_events').update({
      status:        'dismissed',
      processed_at:  new Date().toISOString(),
      error_message: 'مُستبدَل بنسخة أحدث من نفس النوع',
    }).eq('id', ev.id);
  }
  return { superseded: stale.length };
}

export async function dismissIntake(id, reason = null) {
  const { error } = await supabase
    .from('zoho_intake_events')
    .update({
      status:        'dismissed',
      processed_at:  new Date().toISOString(),
      error_message: reason?.trim() || null,
    })
    .eq('id', id);
  if (error) throw error;
  return { ok: true };
}

export async function deleteIntake(id) {
  // Also remove the file from storage to keep the bucket clean.
  const { data: row } = await supabase
    .from('zoho_intake_events').select('file_path').eq('id', id).maybeSingle();
  if (row?.file_path) {
    await supabase.storage.from(BUCKET).remove([row.file_path]).catch(() => {});
  }
  const { error } = await supabase.from('zoho_intake_events').delete().eq('id', id);
  if (error) throw error;
  return { ok: true };
}
