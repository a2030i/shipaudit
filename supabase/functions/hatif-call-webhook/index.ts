// hatif-call-webhook — webhook هاتف/Voxa.
// 2026-07-31: تحقق HMAC من النص الخام، والمكالمة العادية أصبحت حدثاً تحليلياً فقط.
// v5: يسجّل **كل** أحداث مساحة العمل {data, eventType} في hatif_events (تعيين/نشاط
// محادثة… أساس تتبّع الإسناد والأداء) + يلتقط أحداث المكالمات في hatif_calls.
// v4: دعم مغلّف {data, eventType}.
// verify_jwt=false — الحماية الأساسية توقيع HMAC؛ ?key= انتقال مؤقت حتى تفعيل السر.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { authorizeHatifWebhook } from '../_shared/hatifWebhookAuth.ts';

const svc = () => createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });

function norm(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('966')) return d;
  if (d.length === 10 && d.startsWith('05')) return '966' + d.slice(1);
  if (d.length === 9 && d.startsWith('5')) return '966' + d;
  return d;
}
function durSecs(s) {
  const m = String(s || '').match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!m) { const n = Number(s); return Number.isFinite(n) && n > 0 ? n : null; }
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
}
const STATUS_MAP = { '0': 'Active', '1': 'Completed', '2': 'Missed', '3': 'RejectedByCaller', '4': 'RejectedByCallee', '5': 'NoAnswer', '6': 'Cancelled', '7': 'Failed', '8': 'Ringing' };
const SENTIMENT_MAP = { '1': 'Positive', '2': 'Neutral', '3': 'Negative', '4': 'Mixed', '5': 'Unknown' };
const pick = (o, ...keys) => { for (const k of keys) { const v = o?.[k]; if (v !== undefined && v !== null && v !== '') return v; } return null; };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  const db = svc();
  const rawBody = await req.text();
  const auth = await authorizeHatifWebhook(req, db, rawBody);
  if (!auth.ok) {
    console.warn('hatif call webhook rejected:', auth.reason);
    return new Response('forbidden', { status: 403 });
  }
  if (auth.mode === 'legacy_key') console.warn('hatif call webhook accepted through transitional legacy key');

  let p = {};
  try { p = JSON.parse(rawBody); } catch { return ok(); }

  // مغلّف مساحة العمل {data, eventType}: سجّل كل حدث (لا ترمي شيئاً)،
  // ثم إن كان مكالمة أكمل لـhatif_calls، وإلا (حدث محادثة) يكتفي بالتسجيل.
  if (p && p.eventType && p.data && typeof p.data === 'object') {
    const d = p.data;
    try {
      await db.from('hatif_events').insert({
        event_type: String(p.eventType),
        workspace_id: d.workspaceId ? String(d.workspaceId) : null,
        conversation_id: (d.id ?? d.conversationId) ? String(d.id ?? d.conversationId) : null,
        contact_id: d.contactId ? String(d.contactId) : null,
        assigned_user_id: d.assignedUserId ? String(d.assignedUserId) : null,
        assigned_team_id: d.assignedTeamId ? String(d.assignedTeamId) : null,
        status: (typeof d.status === 'number') ? d.status : null,
        data: p,
      });
    } catch (e) { console.error('hatif_events insert failed:', e.message); }
    const looksLikeCall = d.callId || d.callLength || d.callDurationSeconds || d.callerNumber || d.calleeNumber || /call/i.test(String(p.eventType));
    if (!looksLikeCall) return ok();
    p = d;
  }

  const callId = pick(p, 'callId', 'CallId');
  const type = pick(p, 'type', 'Type');
  const caller = pick(p, 'callerNumber', 'CallerNumber');
  const callee = pick(p, 'calleeNumber', 'CalleeNumber');
  const contactNum = pick(p, 'contactNumber', 'ContactNumber');
  const custRaw = contactNum || (String(type) === '2' ? callee : caller) || caller || callee;
  const statusCode = pick(p, 'status', 'Status');
  const sentCode = pick(p, 'sentiment', 'Sentiment');

  const row = {
    provider_call_id: callId ? String(callId) : null,
    contact_id:      (pick(p, 'contactId', 'ContactId') ?? null) && String(pick(p, 'contactId', 'ContactId')),
    conversation_id: (pick(p, 'conversationId', 'ConversationId') ?? null) && String(pick(p, 'conversationId', 'ConversationId')),
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

  if (!row.provider_call_id && !row.phone && row.call_type == null) return ok();

  try {
    if (row.provider_call_id) await db.from('hatif_calls').upsert(row, { onConflict: 'provider_call_id' });
    else await db.from('hatif_calls').insert(row);
  } catch (e) { console.error('hatif_calls insert failed:', e.message); }

  return ok();
});
