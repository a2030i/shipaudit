// hatif-call-webhook — webhook هاتف/Voxa.
// 2026-07-31: تحقق HMAC من النص الخام، والمكالمة العادية أصبحت حدثاً تحليلياً فقط.
// v5: يسجّل **كل** أحداث مساحة العمل {data, eventType} في hatif_events (تعيين/نشاط
// محادثة… أساس تتبّع الإسناد والأداء) + يلتقط أحداث المكالمات في hatif_calls.
// v4: دعم مغلّف {data, eventType}.
// verify_jwt=false — الحماية الأساسية توقيع HMAC؛ ?key= انتقال مؤقت حتى تفعيل السر.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { authorizeHatifWebhook } from '../_shared/hatifWebhookAuth.ts';
import { claimHatifWebhookEvent, failHatifWebhookEvent, finishHatifWebhookEvent, hatifErrorMessage } from '../_shared/hatifReliability.ts';

const svc = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const retry = (message: string) => new Response(JSON.stringify({ ok: false, retry: true, error: message }), {
  status: 500, headers: { 'Content-Type': 'application/json' },
});

function norm(raw: unknown) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('966')) return d;
  if (d.length === 10 && d.startsWith('05')) return '966' + d.slice(1);
  if (d.length === 9 && d.startsWith('5')) return '966' + d;
  return d;
}
function durSecs(s: unknown) {
  const m = String(s || '').match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!m) { const n = Number(s); return Number.isFinite(n) && n > 0 ? n : null; }
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
}
const STATUS_MAP: Record<string, string> = { '0': 'Active', '1': 'Completed', '2': 'Missed', '3': 'RejectedByCaller', '4': 'RejectedByCallee', '5': 'NoAnswer', '6': 'Cancelled', '7': 'Failed', '8': 'Ringing' };
const SENTIMENT_MAP: Record<string, string> = { '1': 'Positive', '2': 'Neutral', '3': 'Negative', '4': 'Mixed', '5': 'Unknown' };
const pick = (o: Record<string, any> | null, ...keys: string[]) => { for (const k of keys) { const v = o?.[k]; if (v !== undefined && v !== null && v !== '') return v; } return null; };

function constantTimeEqual(left: string, right: string) {
  let mismatch = left.length ^ right.length;
  const width = Math.max(left.length, right.length);
  for (let i = 0; i < width; i += 1) {
    mismatch |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

async function isInternalReplay(req: Request, db: ReturnType<typeof svc>) {
  const supplied = (req.headers.get('X-Cron-Key') || '').trim();
  if (!supplied) return false;
  const { data } = await db.from('zoho_auth').select('cron_key').eq('id', 1).maybeSingle();
  const expected = String(data?.cron_key || '');
  return !!expected && constantTimeEqual(supplied, expected);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  const db = svc();
  const rawBody = await req.text();
  // Internal replay is limited to the rotated server-side cron key. It lets us
  // recover payloads already stored in the durable inbox without exposing the
  // provider's HMAC secret or weakening normal callback verification.
  const internalReplay = await isInternalReplay(req, db);
  const auth = internalReplay
    ? { ok: true, mode: 'internal_replay' as const }
    : await authorizeHatifWebhook(req, db, rawBody);
  if (!auth.ok) {
    console.warn('hatif call webhook rejected:', auth.reason);
    return new Response('forbidden', { status: 403 });
  }
  if (auth.mode === 'legacy_key') console.warn('hatif call webhook accepted through transitional legacy key');

  let envelope: Record<string, any> = {};
  try { envelope = JSON.parse(rawBody); } catch { return ok(); }
  const wrapped = !!(envelope?.eventType && envelope?.data && typeof envelope.data === 'object');
  const p: Record<string, any> = wrapped ? envelope.data : envelope;
  const eventType = wrapped ? String(envelope.eventType) : 'post_call';
  const callId = pick(p, 'callId', 'CallId');
  const conversationId = pick(p, 'conversationId', 'ConversationId') || (wrapped ? p.id : null);
  const contactId = pick(p, 'contactId', 'ContactId');
  let eventKey = '';

  try {
    const claim = await claimHatifWebhookEvent(db, {
      source: 'call', rawBody, payload: envelope, eventType,
      callId: callId ? String(callId) : null,
      conversationId: conversationId ? String(conversationId) : null,
      contactId: contactId ? String(contactId) : null,
    });
    eventKey = claim.eventKey;
    if (!claim.claimed) return ok();

    const persistWorkspaceEvent = async () => {
      if (!wrapped) return;
      const { error } = await db.from('hatif_events').upsert({
        inbox_event_key: eventKey,
        event_type: eventType,
        workspace_id: p.workspaceId ? String(p.workspaceId) : null,
        conversation_id: conversationId ? String(conversationId) : null,
        contact_id: contactId ? String(contactId) : null,
        assigned_user_id: p.assignedUserId ? String(p.assignedUserId) : null,
        assigned_team_id: p.assignedTeamId ? String(p.assignedTeamId) : null,
        status: (typeof p.status === 'number') ? p.status : null,
        data: envelope,
      }, { onConflict: 'inbox_event_key' });
      if (error) throw error;
    };

    const looksLikeCall = callId || p.callLength || p.callDurationSeconds || p.callerNumber || p.calleeNumber || /call/i.test(eventType);
    if (!looksLikeCall) {
      await persistWorkspaceEvent();
      await finishHatifWebhookEvent(db, eventKey, 'processed');
      return ok();
    }

    const type = pick(p, 'type', 'Type');
    const caller = pick(p, 'callerNumber', 'CallerNumber');
    const callee = pick(p, 'calleeNumber', 'CalleeNumber');
    const contactNum = pick(p, 'contactNumber', 'ContactNumber');
    const custRaw = contactNum || (String(type) === '2' ? callee : caller) || caller || callee;
    const statusCode = pick(p, 'status', 'Status');
    const sentCode = pick(p, 'sentiment', 'Sentiment');
    const row = {
      provider_call_id: callId ? String(callId) : null,
      contact_id:      contactId ? String(contactId) : null,
      conversation_id: conversationId ? String(conversationId) : null,
      phone:           custRaw ? norm(custRaw) : null,
      contact_number:  contactNum ? String(contactNum) : null,
      call_type:       (String(type) === '1' || String(type) === '2') ? Number(type) : null,
      direction:       String(type) === '1' ? 'inbound' : String(type) === '2' ? 'outbound' : null,
      status:          statusCode != null ? (STATUS_MAP[String(statusCode)] || String(statusCode)) : null,
      duration_seconds: durSecs(pick(p, 'callLength', 'CallLength', 'callDurationSeconds')),
      agent_name:      (pick(p, 'userName', 'UserName') ?? null) && String(pick(p, 'userName', 'UserName')),
      agent_id:        (pick(p, 'userId', 'UserId') ?? null) && String(pick(p, 'userId', 'UserId')),
      sentiment:       sentCode != null ? (SENTIMENT_MAP[String(sentCode)] || String(sentCode)) : null,
      recording_url:   (pick(p, 'recordingUrl', 'RecordingUrl') ?? null) && String(pick(p, 'recordingUrl', 'RecordingUrl')),
      summary:         (pick(p, 'summary', 'Summary') ?? null) && String(pick(p, 'summary', 'Summary')),
      transcription:   pick(p, 'transcription', 'Transcription') || null,
      started_at:      pick(p, 'pickupTime', 'PickupTime') || null,
      ended_at:        pick(p, 'hangupTime', 'HangupTime') || null,
      raw:             p,
    };

    if (!row.provider_call_id && !row.phone && row.call_type == null) {
      await persistWorkspaceEvent();
      await finishHatifWebhookEvent(db, eventKey, 'ignored');
      return ok();
    }

    const write = row.provider_call_id
      ? db.from('hatif_calls').upsert(row, { onConflict: 'provider_call_id' })
      : db.from('hatif_calls').insert(row);
    const { error: callError } = await write;
    if (callError) throw callError;
    await persistWorkspaceEvent();
    await finishHatifWebhookEvent(db, eventKey, 'processed');
    return ok();
  } catch (e) {
    const message = hatifErrorMessage(e);
    console.error('hatif call webhook processing failed:', message);
    if (eventKey) await failHatifWebhookEvent(db, eventKey, e);
    return retry(message);
  }
});
