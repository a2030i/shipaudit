// hatif-call-webhook v1 (2026-07-22) — يستقبل webhook «ما بعد المكالمة» (post-call)
// من هاتف/Voxa بعد كل مكالمة (يدوية للفريق + آلية)، ويسجّلها في hatif_calls لتغذية
// «سجل التواصل في بطاقة العميل». يخزّن الحمولة الخام (raw) + يستخلص الحقول الشائعة
// دفاعياً (أسماء متعددة) — نُثبّت الاستخلاص بعد رؤية حمولة حقيقية.
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
// أول قيمة غير فارغة من عدة مفاتيح محتملة (تغطية اختلاف تسمية Voxa)
const pick = (o: Record<string, any>, ...keys: string[]) => {
  for (const k of keys) { const v = o?.[k]; if (v !== undefined && v !== null && v !== '') return v; }
  return null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  const db = svc();
  const url = new URL(req.url);
  const key = url.searchParams.get('key') || '';
  const { data: za } = await db.from('zoho_auth').select('webhook_key').eq('id', 1).maybeSingle();
  if (!za?.webhook_key || key !== za.webhook_key) return new Response('forbidden', { status: 403 });

  let p: Record<string, any> = {};
  try { p = await req.json(); } catch { return ok(); }

  const providerCallId = pick(p, 'callId', 'CallId', 'id', 'Id', 'callSid');
  const phoneRaw = pick(p, 'destinationNumber', 'DestinationNumber', 'phoneNumber', 'PhoneNumber', 'from', 'From', 'to', 'To', 'number', 'contactNumber');
  const row: Record<string, any> = {
    provider_call_id: providerCallId ? String(providerCallId) : null,
    conversation_id:  (pick(p, 'conversationId', 'ConversationId') ?? null) && String(pick(p, 'conversationId', 'ConversationId')),
    contact_id:       (pick(p, 'contactId', 'ContactId') ?? null) && String(pick(p, 'contactId', 'ContactId')),
    phone:            phoneRaw ? norm(phoneRaw) : null,
    direction:        (pick(p, 'direction', 'Direction', 'callDirection') ?? null) && String(pick(p, 'direction', 'Direction', 'callDirection')).toLowerCase(),
    status:           (pick(p, 'status', 'Status', 'callStatus') ?? null) && String(pick(p, 'status', 'Status', 'callStatus')),
    result:           (pick(p, 'result', 'Result', 'outcome') ?? null) && String(pick(p, 'result', 'Result', 'outcome')),
    duration_seconds: Number(pick(p, 'callDurationSeconds', 'durationSeconds', 'duration', 'Duration')) || null,
    agent_name:       (pick(p, 'agentName', 'AgentName', 'userName', 'assignedUserName', 'ownerName') ?? null) && String(pick(p, 'agentName', 'AgentName', 'userName', 'assignedUserName', 'ownerName')),
    agent_id:         (pick(p, 'agentId', 'AgentId', 'userId', 'assignedUserId', 'ownerId') ?? null) && String(pick(p, 'agentId', 'AgentId', 'userId', 'assignedUserId', 'ownerId')),
    sentiment:        (pick(p, 'sentiment', 'Sentiment', 'mood', 'rating') ?? null) && String(pick(p, 'sentiment', 'Sentiment', 'mood', 'rating')),
    started_at:       pick(p, 'answeredAt', 'startedAt', 'initiatedAt', 'creationTime', 'CreationTime', 'startTime') || null,
    ended_at:         pick(p, 'completedAt', 'endedAt', 'endTime') || null,
    raw:              p,
  };

  try {
    if (row.provider_call_id) {
      await db.from('hatif_calls').upsert(row, { onConflict: 'provider_call_id' });
    } else {
      await db.from('hatif_calls').insert(row);
    }
  } catch (e) { console.error('hatif-call-webhook insert failed:', (e as Error).message); }
  return ok();
});
