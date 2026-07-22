// hatif-webhook v9 — يستقبل أحداث Hatif/Voxa (تسليم + ردود) ويحدّث whatsapp_campaign_sends.
// v9 (2026-07-22): **الإسناد بالقالب** — المسؤول عن الرد = المربوط بالقالب في
// whatsapp_config.templateAgents (قالب مالي→بلال، تسويقي→مبيعات)، وإلا مالك المتابعة/المُرسِل.
// v8 (2026-07-22): **إسناد المحادثة تلقائياً** — عند ردّ حقيقي، يُسند المحادثة في
// هاتف لموظف هاتف المربوط بمالك المتابعة/المُرسِل (Assign Conversation) — تظهر عنده مباشرة.
// v7 — يستقبل أحداث Hatif/Voxa (تسليم + ردود) ويحدّث whatsapp_campaign_sends.
// verify_jwt=false — الحماية ?key= ضد zoho_auth.webhook_key.
// v2 (§1.37): أول رد = فرصة حارة → متابعة needs_followup + مهمة crm_task.
// v3: مطابقة متسلسلة (محادثة ثم جهة). v6: كاشف الردود الآلية بالنص.
// v7 (2026-07-22): **كشف آلي بالزمن أيضاً** — البيانات: 77/123 ردّ وصل خلال 30ث
// (الوسيط 9ث) — لا بشر يردّ على قالب تسويقي في 9 ثوانٍ. فالردّ الوارد
// خلال ≤60ث من الإرسال = آلي (أو مطابق لعبارة آلية). يُسجّل بلا مهمة/ردّ حقيقي.
import { createClient } from 'npm:@supabase/supabase-js@2';

const svc = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });

// توكن Voxa (client-credentials) — لإسناد المحادثة عند رد العميل (v8).
const env = (...n: string[]) => { for (const k of n) { const v = Deno.env.get(k); if (v && v.trim()) return v.trim(); } return ''; };
let tokenCache: { token: string; exp: number } | null = null;
async function accessToken() {
  if (tokenCache && tokenCache.exp > Date.now()) return tokenCache.token;
  const id = env('client_id', 'HATIF_CLIENT_ID'), secret = env('secret', 'HATIF_CLIENT_SECRET');
  if (!id || !secret) throw new Error('no hatif secrets');
  const r = await fetch('https://api.voxa.sa/connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret, scope: 'VoxaAPI' }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('token failed');
  tokenCache = { token: j.access_token, exp: Date.now() + ((Number(j.expires_in) || 3600) * 1000) - 60000 };
  return tokenCache.token;
}

const AUTO_REPLY_RE = new RegExp([
  'شكرا?ً?\\s*لتواصلك', 'شكرا?ً?\\s*لتواصلكم', 'شكرا?ً?\\s*على\\s*تواصلك',
  'نشكر\\s*تواصلك', 'سنرد\\s*عليك', 'سيتم\\s*الرد', 'سنتواصل\\s*معك', 'سيتم\\s*التواصل',
  'تم\\s*استلام\\s*رسالتك', 'وصلتنا\\s*رسالتك', 'تم\\s*استلام\\s*طلبك', 'رسالتك\\s*وصلت',
  'خارج\\s*أوقات\\s*العمل', 'أوقات\\s*العمل', 'ساعات\\s*العمل', 'دوام\\s*العمل',
  'مرحبا?ً?\\s*بك\\s*في', 'أهلا?ً?\\s*بك\\s*في', 'مرحبا\\s*بكم', 'رسالة\\s*تلقائية', 'رد\\s*تلقائي',
  'thank\\s*you\\s*for\\s*contact', 'we\\s*will\\s*get\\s*back', 'we.?ll\\s*get\\s*back', 'out\\s*of\\s*office',
  'away\\s*message', 'auto(?:mated|-?reply|\\s*reply)', 'office\\s*hours', 'received\\s*your\\s*message', 'currently\\s*unavailable',
].join('|'), 'i');
const isAutoText = (b: string | null) => !!b && AUTO_REPLY_RE.test(String(b));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  const db = svc();
  const url = new URL(req.url);
  const key = url.searchParams.get('key') || '';
  const { data: za } = await db.from('zoho_auth').select('webhook_key').eq('id', 1).maybeSingle();
  if (!za?.webhook_key || key !== za.webhook_key) return new Response('forbidden', { status: 403 });

  let p: Record<string, any> = {};
  try { p = await req.json(); } catch { return ok(); }

  const conversationId = p.conversationId || p.ConversationId || null;
  const contactId      = p.contactId || p.ContactId || null;
  const direction      = String(p.direction || p.Direction || '').toLowerCase();
  const status         = String(p.status || p.Status || '');
  const body           = p.body || p.Body || null;
  const when           = p.creationTime || p.CreationTime || new Date().toISOString();
  if (!conversationId && !contactId) return ok();

  const SEL = 'id, phone, replied_at, sent_by, name, conversation_id, sent_at, template_name';
  let row: Record<string, any> | null = null;
  if (conversationId) {
    const { data } = await db.from('whatsapp_campaign_sends').select(SEL)
      .eq('conversation_id', conversationId).order('sent_at', { ascending: false }).limit(1);
    row = data?.[0] || null;
  }
  if (!row && contactId) {
    const { data } = await db.from('whatsapp_campaign_sends').select(SEL)
      .eq('contact_id', contactId).order('sent_at', { ascending: false }).limit(1);
    row = data?.[0] || null;
  }
  if (!row) return ok();

  const patch: Record<string, any> = {};
  if (conversationId && !row.conversation_id) patch.conversation_id = conversationId;
  let firstReply = false;
  if (direction === 'inbound') {
    // آلي = مطابق لعبارة آلية أو وصل خلال ≤60ث من الإرسال (أقوى إشارة)
    let secs: number | null = null;
    if (row.sent_at) { const d = (new Date(when).getTime() - new Date(row.sent_at).getTime()) / 1000; if (Number.isFinite(d)) secs = d; }
    const auto = isAutoText(body) || (secs !== null && secs >= 0 && secs <= 60);
    if (auto) {
      patch.reply_is_auto = true;
      patch.auto_reply_at = when;
      if (body) patch.reply_body = String(body).slice(0, 500);
    } else if (!row.replied_at) {
      patch.replied_at = when;
      patch.reply_body = body ? String(body).slice(0, 500) : null;
      patch.reply_is_auto = false;
      firstReply = true;
    }
  } else {
    if (status) patch.status = status;
    if (status === 'Delivered') patch.delivered_at = when;
    if (status === 'Read')      { patch.read_at = when; patch.delivered_at = when; }
    if (status === 'Failed')    patch.error_reason = p.errorReason || p.ErrorReason || String(p.errorCode || 'failed');
  }
  if (Object.keys(patch).length) {
    try { await db.from('whatsapp_campaign_sends').update(patch).eq('id', row.id); } catch { /* */ }
  }

  if (firstReply && row.phone) {
    try {
      const { data: fu } = await db.from('retargeting_followups')
        .select('phone, status, owner_id').eq('phone', row.phone).maybeSingle();
      const FINAL = new Set(['converted', 'returned', 'supplier', 'noise', 'blacklist', 'test']);
      if (!fu || !FINAL.has(fu.status)) {
        await db.from('retargeting_followups').upsert({
          phone: row.phone, status: 'needs_followup',
          owner_id: fu?.owner_id ?? (row.sent_by && row.sent_by.length > 20 ? row.sent_by : null),
          last_touch_at: when, updated_at: new Date().toISOString(),
        }, { onConflict: 'phone' });
      }
      // الأولوية للمسؤول عن القالب (templateAgents) — قالب مالي→بلال، تسويقي→مبيعات؛
      // وإلا مالك المتابعة، وإلا مُرسِل الحملة.
      let tplOwner: string | null = null;
      try {
        const { data: cfgRow } = await db.from('app_settings').select('value').eq('key', 'whatsapp_config').maybeSingle();
        if (cfgRow?.value && row.template_name) tplOwner = (JSON.parse(cfgRow.value).templateAgents || {})[row.template_name] || null;
      } catch { /* */ }
      const assignee = tplOwner ?? fu?.owner_id ?? (row.sent_by && row.sent_by.length > 20 ? row.sent_by : null);
      if (assignee) {
        const { error: taskErr } = await db.from('crm_tasks').insert({
          title: `↩️ ردّ وارد من ${row.name || row.phone} — تابِعه الآن`,
          kind: 'followup', entity_type: 'retargeting', entity_ref: row.phone,
          assigned_to: assignee, due_at: new Date().toISOString(), priority: 'high', status: 'open',
        });
        if (taskErr) console.error('crm_task insert failed on reply:', taskErr.message);
        // إسناد المحادثة في هاتف لموظف هاتف المربوط بالمالك (v8) — Assign Conversation
        try {
          const { data: prof } = await db.from('profiles').select('hatif_user_id').eq('id', assignee).maybeSingle();
          const convId = conversationId || row.conversation_id;
          if (prof?.hatif_user_id && convId) {
            const tok = await accessToken();
            await fetch(`https://api.voxa.sa/v2/conversations/service-account/${convId}/assign`, {
              method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
              body: JSON.stringify({ assignedUserId: prof.hatif_user_id }),
            });
          }
        } catch (e) { console.error('assign conversation failed:', (e as Error).message); }
      }
    } catch (e) { console.error('reply→task handler failed:', (e as Error).message); }
  }
  return ok();
});
