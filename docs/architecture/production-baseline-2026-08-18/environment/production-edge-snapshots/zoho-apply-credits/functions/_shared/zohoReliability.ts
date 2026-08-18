import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

type Db = SupabaseClient;

const hex = (bytes: Uint8Array) =>
  Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}

export async function claimWebhook(
  db: Db,
  input: {
    eventKey: string;
    eventType?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    providerModifiedAt?: string | null;
    payload: unknown;
  },
) {
  const now = new Date().toISOString();
  const row = {
    event_key: input.eventKey,
    event_type: input.eventType || null,
    entity_type: input.entityType || null,
    entity_id: input.entityId || null,
    provider_modified_at: input.providerModifiedAt || null,
    payload: input.payload || {},
    status: 'processing',
    received_at: now,
    processing_started_at: now,
  };
  const { error } = await db.from('zoho_webhook_inbox').insert(row);
  if (!error) return { claimed: true as const, attempt: 1 };
  if (error.code !== '23505') throw new Error(`webhook inbox insert: ${error.message}`);

  const { data: prior, error: readError } = await db.from('zoho_webhook_inbox')
    .select('status, attempts, processing_started_at')
    .eq('event_key', input.eventKey).maybeSingle();
  if (readError) throw new Error(`webhook inbox read: ${readError.message}`);
  const stale = prior?.status === 'processing' &&
    Date.now() - new Date(prior.processing_started_at).getTime() > 2 * 60_000;
  if (prior?.status !== 'failed' && !stale) {
    return { claimed: false as const, status: prior?.status || 'unknown' };
  }

  const nextAttempt = Number(prior?.attempts || 1) + 1;
  const { data: reclaimed, error: reclaimError } = await db.from('zoho_webhook_inbox')
    .update({
      status: 'processing', attempts: nextAttempt, processing_started_at: now,
      processed_at: null, last_error: null, payload: input.payload || {},
    })
    .eq('event_key', input.eventKey)
    .eq('status', prior?.status || 'processing')
    .select('event_key').maybeSingle();
  if (reclaimError) throw new Error(`webhook inbox reclaim: ${reclaimError.message}`);
  return reclaimed
    ? { claimed: true as const, attempt: nextAttempt }
    : { claimed: false as const, status: 'claimed_elsewhere' };
}

export async function finishWebhook(
  db: Db,
  eventKey: string,
  status: 'processed' | 'ignored' | 'failed',
  error?: string | null,
) {
  const { error: updateError } = await db.from('zoho_webhook_inbox').update({
    status,
    processed_at: new Date().toISOString(),
    last_error: error ? error.slice(0, 2000) : null,
  }).eq('event_key', eventKey);
  if (updateError) throw new Error(`webhook inbox finish: ${updateError.message}`);
}

export async function beginSyncRun(
  db: Db,
  triggerSource: 'manual' | 'cron' | 'full_rebuild',
  requestedBy?: string | null,
) {
  const runKey = crypto.randomUUID();
  const { data, error } = await db.from('zoho_sync_runs').insert({
    run_key: runKey,
    trigger_source: triggerSource,
    requested_by: requestedBy || null,
  }).select('id, run_key').single();
  if (error) throw new Error(`sync run start: ${error.message}`);
  return data as { id: number; run_key: string };
}

export async function finishSyncRun(
  db: Db,
  id: number,
  status: 'succeeded' | 'partial' | 'failed',
  results: Record<string, unknown>,
  apiCalls: number,
  error?: string | null,
) {
  const { error: updateError } = await db.from('zoho_sync_runs').update({
    status,
    results,
    api_calls: apiCalls,
    error: error ? error.slice(0, 4000) : null,
    finished_at: new Date().toISOString(),
  }).eq('id', id);
  if (updateError) throw new Error(`sync run finish: ${updateError.message}`);
}

export async function claimWriteOperation(
  db: Db,
  input: {
    idempotencyKey: string;
    action: string;
    contactId?: string | null;
    requestedBy?: string | null;
    payload?: unknown;
  },
) {
  const { data, error } = await db.from('zoho_write_operations').insert({
    idempotency_key: input.idempotencyKey,
    action: input.action,
    contact_id: input.contactId || null,
    requested_by: input.requestedBy || null,
    request_payload: input.payload || {},
  }).select('id').single();
  if (!error) return { claimed: true as const, id: data.id as number };
  if (error.code !== '23505') throw new Error(`write operation start: ${error.message}`);
  const { data: prior, error: readError } = await db.from('zoho_write_operations')
    .select('id, status, result_payload, applied_amount, last_error')
    .eq('idempotency_key', input.idempotencyKey).single();
  if (readError) throw new Error(`write operation read: ${readError.message}`);
  return { claimed: false as const, prior };
}

export async function finishWriteOperation(
  db: Db,
  id: number,
  status: 'succeeded' | 'partial' | 'failed' | 'unknown',
  result: Record<string, unknown>,
  appliedAmount: number,
  error?: string | null,
) {
  const { error: updateError } = await db.from('zoho_write_operations').update({
    status,
    result_payload: result,
    applied_amount: Number.isFinite(appliedAmount) ? appliedAmount : 0,
    last_error: error ? error.slice(0, 4000) : null,
    finished_at: new Date().toISOString(),
  }).eq('id', id);
  if (updateError) throw new Error(`write operation finish: ${updateError.message}`);
}

