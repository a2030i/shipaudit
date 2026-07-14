// hatif-webhook — يستقبل أحداث رسائل Hatif/Voxa (حالة التسليم + الردود الواردة)
// ويحدّث whatsapp_campaign_sends. verify_jwt=false — الحماية عبر ?key= ضد
// zoho_auth.webhook_key (نفس نمط zoho-webhook). لا استدعاء زوهو/Hatif هنا.
//
// حمولة Voxa (whatsapp-message-webhook): {
//   workspaceId, channelId, conversationId, contactId, messageId, direction,
//   messageType, body, status, creationTime, isBillable, errorCode, errorReason }
// direction: Inbound|Outbound · status: Sent|Delivered|Read|Pending|Failed
// لا رقم هاتف في الحمولة — نطابق بـ conversationId ثم contactId على أحدث إرسال.
import { createClient } from 'npm:@supabase/supabase-js@2';

const svc = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  const db = svc();
  const url = new URL(req.url);

  // بوابة السرّ
  const key = url.searchParams.get('key') || '';
  const { data: za } = await db.from('zoho_auth').select('webhook_key').eq('id', 1).maybeSingle();
  if (!za?.webhook_key || key !== za.webhook_key) return new Response('forbidden', { status: 403 });

  let p: Record<string, any> = {};
  try { p = await req.json(); } catch { return ok(); }   // نرجع 200 دائماً (لا إعادة محاولة لا نهائية)

  const conversationId = p.conversationId || p.ConversationId || null;
  const contactId      = p.contactId || p.ContactId || null;
  const direction      = String(p.direction || p.Direction || '').toLowerCase();
  const status         = String(p.status || p.Status || '');
  const body           = p.body || p.Body || null;
  const when           = p.creationTime || p.CreationTime || new Date().toISOString();
  if (!conversationId && !contactId) return ok();

  // أحدث صف إرسال يطابق المحادثة أو الجهة
  let q = db.from('whatsapp_campaign_sends').select('id, replied_at').order('sent_at', { ascending: false }).limit(1);
  q = conversationId ? q.eq('conversation_id', conversationId) : q.eq('contact_id', contactId);
  const { data: rows } = await q;
  const row = rows?.[0];
  if (!row) return ok();

  const patch: Record<string, any> = {};
  if (direction === 'inbound') {
    // أول رد وارد بعد الإرسال
    if (!row.replied_at) { patch.replied_at = when; patch.reply_body = body ? String(body).slice(0, 500) : null; }
  } else {
    // تحديث حالة الإرسال الصادر
    if (status) patch.status = status;
    if (status === 'Delivered') patch.delivered_at = when;
    if (status === 'Read')      { patch.read_at = when; patch.delivered_at = when; }
    if (status === 'Failed')    patch.error_reason = p.errorReason || p.ErrorReason || String(p.errorCode || 'failed');
  }
  if (Object.keys(patch).length) {
    try { await db.from('whatsapp_campaign_sends').update(patch).eq('id', row.id); } catch { /* */ }
  }
  return ok();
});
