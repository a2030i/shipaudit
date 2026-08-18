// Durable idempotency primitives shared by Hatif webhooks and senders.

const encoder = new TextEncoder();

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export type HatifInboxInput = {
  source: 'whatsapp' | 'call';
  rawBody: string;
  payload: Record<string, unknown>;
  eventType?: string | null;
  messageId?: string | null;
  callId?: string | null;
  conversationId?: string | null;
  contactId?: string | null;
};

export async function claimHatifWebhookEvent(db: any, input: HatifInboxInput) {
  const eventKey = await sha256Hex(`${input.source}\n${input.rawBody}`);
  const now = new Date().toISOString();
  const row = {
    event_key: eventKey,
    source: input.source,
    event_type: input.eventType || null,
    message_id: input.messageId || null,
    call_id: input.callId || null,
    conversation_id: input.conversationId || null,
    contact_id: input.contactId || null,
    payload: input.payload,
    status: 'processing',
    attempt_count: 1,
    received_at: now,
    last_attempt_at: now,
  };
  const { error } = await db.from('hatif_webhook_inbox').insert(row);
  if (!error) return { eventKey, claimed: true, duplicate: false };
  if (error.code !== '23505') throw new Error(`hatif inbox insert failed: ${error.message}`);

  const { data: previous, error: readError } = await db.from('hatif_webhook_inbox')
    .select('status, attempt_count, last_attempt_at').eq('event_key', eventKey).maybeSingle();
  if (readError || !previous) throw new Error(`hatif inbox duplicate read failed: ${readError?.message || 'missing row'}`);

  // A failed attempt is retryable.  A processing attempt is reclaimable only
  // after one minute; this avoids concurrent processing while recovering from
  // a killed Edge Function before Hatif's first retry (normally two minutes).
  const staleBefore = new Date(Date.now() - 60_000).toISOString();
  let retry = db.from('hatif_webhook_inbox').update({
    status: 'processing',
    attempt_count: Number(previous.attempt_count || 1) + 1,
    last_attempt_at: now,
    last_error: null,
  }).eq('event_key', eventKey);
  if (previous.status === 'failed') retry = retry.eq('status', 'failed');
  else if (previous.status === 'processing' && previous.last_attempt_at < staleBefore) {
    retry = retry.eq('status', 'processing').lt('last_attempt_at', staleBefore);
  } else {
    return { eventKey, claimed: false, duplicate: true, status: previous.status };
  }
  const { data: reclaimed, error: retryError } = await retry.select('event_key');
  if (retryError) throw new Error(`hatif inbox reclaim failed: ${retryError.message}`);
  return { eventKey, claimed: !!reclaimed?.length, duplicate: !reclaimed?.length, status: previous.status };
}

export async function finishHatifWebhookEvent(
  db: any,
  eventKey: string,
  status: 'processed' | 'ignored' | 'unmatched',
) {
  const now = new Date().toISOString();
  const { error } = await db.from('hatif_webhook_inbox').update({
    status,
    processed_at: now,
    last_attempt_at: now,
    last_error: null,
  }).eq('event_key', eventKey);
  if (error) throw new Error(`hatif inbox finish failed: ${error.message}`);
}

export async function failHatifWebhookEvent(db: any, eventKey: string, reason: unknown) {
  const message = String(reason instanceof Error ? reason.message : reason).slice(0, 1000);
  const { error } = await db.from('hatif_webhook_inbox').update({
    status: 'failed',
    last_attempt_at: new Date().toISOString(),
    last_error: message,
  }).eq('event_key', eventKey);
  if (error) console.error('hatif inbox failure marker failed:', error.message);
}

export type HatifSendClaimInput = {
  source: 'immediate' | 'scheduled' | 'drip';
  phone: string;
  templateName: string;
  campaignName?: string | null;
  sourceReference?: string | null;
};

export async function makeHatifSendKey(input: HatifSendClaimInput) {
  return sha256Hex([
    input.campaignName || '',
    input.templateName,
    input.phone,
    input.sourceReference || '',
  ].join('\n'));
}

export async function claimHatifSend(db: any, input: HatifSendClaimInput) {
  const idempotencyKey = await makeHatifSendKey(input);
  const now = new Date().toISOString();
  const row = {
    idempotency_key: idempotencyKey,
    source: input.source,
    phone: input.phone,
    template_name: input.templateName,
    campaign_name: input.campaignName || null,
    source_reference: input.sourceReference || null,
    status: 'sending',
    attempt_count: 1,
    created_at: now,
    updated_at: now,
  };
  const { error } = await db.from('hatif_send_claims').insert(row);
  if (!error) return { idempotencyKey, claimed: true, duplicate: false };
  if (error.code !== '23505') throw new Error(`hatif send claim failed: ${error.message}`);

  const { data: previous, error: readError } = await db.from('hatif_send_claims')
    .select('status, attempt_count').eq('idempotency_key', idempotencyKey).maybeSingle();
  if (readError || !previous) throw new Error(`hatif send claim read failed: ${readError?.message || 'missing row'}`);
  // Only a provider-confirmed failure may be retried.  `sending` and `unknown`
  // are intentionally blocked because the request may already have reached Hatif.
  if (previous.status !== 'failed') {
    return { idempotencyKey, claimed: false, duplicate: true, status: previous.status };
  }
  const { data: reclaimed, error: retryError } = await db.from('hatif_send_claims').update({
    status: 'sending',
    attempt_count: Number(previous.attempt_count || 1) + 1,
    updated_at: now,
    last_error: null,
  }).eq('idempotency_key', idempotencyKey).eq('status', 'failed').select('idempotency_key');
  if (retryError) throw new Error(`hatif send reclaim failed: ${retryError.message}`);
  return { idempotencyKey, claimed: !!reclaimed?.length, duplicate: !reclaimed?.length, status: previous.status };
}

export async function finishHatifSendClaim(
  db: any,
  idempotencyKey: string,
  status: 'sent' | 'failed' | 'unknown',
  result: Record<string, unknown> = {},
) {
  const patch = {
    status,
    updated_at: new Date().toISOString(),
    provider_message_id: result.messageId || null,
    provider_contact_id: result.contactId || null,
    provider_conversation_id: result.conversationId || null,
    provider_status: result.providerStatus || null,
    last_error: result.error ? String(result.error).slice(0, 1000) : null,
  };
  const { error } = await db.from('hatif_send_claims').update(patch).eq('idempotency_key', idempotencyKey);
  if (error) throw new Error(`hatif send claim finish failed: ${error.message}`);
}

