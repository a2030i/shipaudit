// hatif-call-webhook v2 (2026-07-22) — webhook «ما بعد المكالمة» من هاتف/Voxa.
// مواصفة مؤكّدة من التوثيق: يطلق عند اكتمال كل مكالمة (وارد type=1 / صادر type=2،
// ومكالمات AI). يحمل التسجيل (recordingUrl) + النصّ (transcription) + الملخّص (summary)
// + المشاعر (sentiment) + الموظف (userName) — يغذّي «سجل التواصل في بطاقة العميل».
// verify_jwt=false — الحماية ?key= ضد zoho_auth.webhook_key. يرجع 200 دائماً.
import { createClient } from 'npm:@supabase/supabase-js@2';

const svc = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });

function norm(raw: unknown) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('966')) return d;
  if (d.length === 10 && d.startsWith('05')) return '966' + d.slice(1);
  if (d.length === 9 && d.startsWith('5')) return '966' + d;
  return d;
}
// callLength "HH:MM:SS" → ثوانٍ
function durSecs(s: unknown): number | null {
  const m = String(s || '').match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!m) { const n = Number(s); return Number.isFinite(n) && n > 0 ? n : null; }
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
}
// status: 0=Active 1=Completed 2=Missed 3=RejectedByCaller 4=RejectedByCallee 5=NoAnswer 6=Cancelled 7=Failed 8=Ringing
const STATUS_MAP: Record<string, string> = { '0': 'Active', '1': 'Completed', '2': 'Missed', '3': 'RejectedByCaller', '4': 'RejectedByCallee', '5': 'NoAnswer', '6': 'Cancelled', '7': 'Failed', '8': 'Ringing' };
// sentiment: 1=Positive 2=Neutral 3=Negative 4=Mixed 5=Unknown
const SENTIMENT_MAP: Record<string, string> = { '1': 'Positive', '2': 'Neutral', '3': 'Negative', '4': 'Mixed', '5': 'Unknown' };
const pick = (o: Record<string, any>, ...keys: string[]) => { for (const k of keys) { const v = o?.[k]; if (v !== undefined && v !== null && v !== '') return v; } return null; };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  const db = svc();
  const url = new URL(req.url);
  const key = url.searchParams.get('key') || '';
  const { data: za } = await db.from('zoho_auth').select('webhook_key').eq('id', 1).maybeSingle();
  if (!za?.webhook_key || key !== za.webhook_key) return new Response('forbidden', { status: 403 });

  let p: Record<string, any> = {};
  try { p = await req.json(); } catch { return ok(); }

  const callId = pick(p, 'callId', 'CallId');
  const type = pick(p, 'type', 'Type');                                   // 1=وارد 2=صادر
  const caller = pick(p, 'callerNumber', 'CallerNumber');
  const callee = pick(p, 'calleeNumber', 'CalleeNumber');
  const contactNum = pick(p, 'contactNumber', 'ContactNumber');
  // رقم العميل: جهة الاتصال إن وُجدت، وإلا الطرف الآخر حسب الاتجاه (صادر=المُتَّصَل به)
  const custRaw = contactNum || (String(type) === '2' ? callee : caller) || caller || callee;
  const statusCode = pick(p, 'status', 'Status');
  const sentCode = pick(p, 'sentiment', 'Sentiment');

  const row: Record<string, any> = {
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

  try {
    if (row.provider_call_id) await db.from('hatif_calls').upsert(row, { onConflict: 'provider_call_id' });
    else await db.from('hatif_calls').insert(row);
  } catch (e) { console.error('hatif-call-webhook insert failed:', (e as Error).message); }
  return ok();
});
