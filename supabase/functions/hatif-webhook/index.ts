// hatif-webhook — يستقبل أحداث Hatif/Voxa (تسليم + ردود) ويحدّث whatsapp_campaign_sends.
// 2026-07-31: توقيع X-Voxa-Signature على النص الخام + إلغاء إنشاء مهام CRM من
// الرد العادي. هاتف هو صندوق المحادثة؛ لمحة تقيس القناة فقط ما لم توجد إحالة صريحة.
// v14 (2026-07-27): **توسيع كاشف بوتات المتاجر** — حادثة: قائمة «عميل حار» امتلأت
// بردّادات ترحيب المتاجر المتأخرة (>60ث): «حياك الله في…»/«عزيزي العميل»/«في أقرب
// وقت ممكن»/«تم تغيير رقم خدمة العملاء». النمط مُوحَّد مع SQL reply_intent().
// v13 (2026-07-23، خطة هاتف البند 3): حجز ذرّي لأول رد (UPDATE…WHERE replied_at IS NULL
// RETURNING) — من يكسب الصفّ وحده يُنشئ المهمة/المتابعة، فلا ازدواج عند ردّين متزامنين.
// v12 (2026-07-22): **نافذة أتمتة = 3 أيام من الإرسال** — الإسناد/المهمة منّا داخل
// 3 أيام فقط؛ رد بعدها → تمشي المحادثة على أتمتة هاتف (سياق مختلف).
// v11 (2026-07-22): **الإسناد على أول رد حتى لو آلي** (قرار المستخدم) — الإسناد توجيه
// لا يزعج أحداً، فيتمّ على أول رد وارد (آلي أو حقيقي) مرة واحدة (hatif_assigned_at).
// templateAgents = Voxa userId (الفريق في هاتف). لا تُنشأ مهام لمجرد الرد.
// verify_jwt=false — الحماية الأساسية توقيع HMAC؛ ?key= انتقال مؤقت حتى تفعيل السر.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { authorizeHatifWebhook } from '../_shared/hatifWebhookAuth.ts';

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

// v14: النمط موسَّع بردّادات ترحيب المتاجر — موحَّد مع reply_intent() في SQL.
const AUTO_REPLY_RE = new RegExp([
  'شكرا?ً?\\s*لتواصلك', 'شكرا?ً?\\s*لتواصلكم', 'شكرا?ً?\\s*على\\s*تواصلك',
  'نشكر\\s*تواصلك', 'سنرد\\s*عليك', 'سيتم\\s*الرد', 'سنتواصل\\s*معك', 'سيتم\\s*التواصل',
  'سنقوم\\s*بالرد', 'في\\s*أقرب\\s*وقت', 'يسعدنا\\s*تواصلك', 'يسعدنا\\s*خدمتك',
  'تم\\s*استلام\\s*رسالتك', 'وصلتنا\\s*رسالتك', 'تم\\s*استلام\\s*طلبك', 'رسالتك\\s*وصلت',
  'خارج\\s*أوقات\\s*العمل', 'أوقات\\s*العمل', 'ساعات\\s*العمل', 'دوام\\s*العمل', 'أوقات\\s*الاستقبال',
  'مرحبا?ً?\\s*بك\\s*في', 'أهلا?ً?\\s*بك\\s*في', 'مرحبا\\s*بكم', 'أهلا?ً?\\s*وسهلا?ً?\\s*بكم',
  'حياكم?\\s*الله\\s*(في|ب)', 'عزيز(ي|تي)\\s*العميل', 'ا?إ?ستفسارك\\s*محل',
  'يرجى\\s*إخبارنا', 'أخبرنا\\s*كيف\\s*يمكننا', 'بما\\s*يمكننا\\s*القيام',
  'تم\\s*تغيير\\s*رقم', 'خدمة\\s*العملاء', 'المحل\\s*مغلق',
  'زيارة\\s*الموقع', 'تفضل.{0,6}(بزيارة|على\\s*الموقع)', 'اختار.{0,6}الرقم\\s*المناسب',
  'رسالة\\s*تلقائية', 'رد\\s*تلقائي', 'رد\\s*آلي', 'تم\\s*إرسال\\s*هذه\\s*الرسالة\\s*تلقائ',
  'thank\\s*you\\s*for\\s*contact', 'we\\s*will\\s*get\\s*back', 'we.?ll\\s*get\\s*back', 'out\\s*of\\s*office',
  'away\\s*message', 'auto(?:mated|-?reply|\\s*reply)', 'office\\s*hours', 'received\\s*your\\s*message', 'currently\\s*unavailable',
].join('|'), 'i');
const isAutoText = (b: string | null) => !!b && AUTO_REPLY_RE.test(String(b));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  const db = svc();
  const rawBody = await req.text();
  const auth = await authorizeHatifWebhook(req, db, rawBody);
  if (!auth.ok) {
    console.warn('hatif webhook rejected:', auth.reason);
    return new Response('forbidden', { status: 403 });
  }
  if (auth.mode === 'legacy_key') console.warn('hatif webhook accepted through transitional legacy key');

  let p: Record<string, any> = {};
  try { p = JSON.parse(rawBody); } catch { return ok(); }

  const conversationId = p.conversationId || p.ConversationId || null;
  const contactId      = p.contactId || p.ContactId || null;
  const messageId      = p.messageId || p.MessageId || null;
  const direction      = String(p.direction || p.Direction || '').toLowerCase();
  const status         = String(p.status || p.Status || '');
  const body           = p.body || p.Body || null;
  const when           = p.creationTime || p.CreationTime || new Date().toISOString();
  if (!messageId && !conversationId && !contactId) return ok();

  const SEL = 'id, phone, replied_at, sent_by, name, conversation_id, message_id, sent_at, template_name, hatif_assigned_at';
  let row: Record<string, any> | null = null;
  // المعرّف الخاص بالرسالة هو الارتباط الحتمي. conversation/contact fallback فقط
  // للرسائل التاريخية التي لم تُرجِع المنصة لها messageId عند الإرسال.
  if (messageId) {
    const { data } = await db.from('whatsapp_campaign_sends').select(SEL)
      .eq('message_id', messageId).order('sent_at', { ascending: false }).limit(1);
    row = data?.[0] || null;
  }
  if (!row && conversationId) {
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
  if (direction === 'inbound') {
    // آلي = مطابق لعبارة آلية أو وصل خلال ≤60ث من الإرسال (أقوى إشارة)
    let secs: number | null = null;
    if (row.sent_at) { const d = (new Date(when).getTime() - new Date(row.sent_at).getTime()) / 1000; if (Number.isFinite(d)) secs = d; }
    const auto = isAutoText(body) || (secs !== null && secs >= 0 && secs <= 60);
    // نافذة أتمتتنا = 3 أيام من الإرسال فقط (قرار المستخدم). بعدها المحادثة قديمة
    // (سياق مختلف) → تمشي على أتمتة هاتف، فلا إسناد ولا مهمة منّا.
    const within3d = secs === null || secs <= 3 * 86400;
    if (auto) {
      patch.reply_is_auto = true;
      patch.auto_reply_at = when;
      if (body) patch.reply_body = String(body).slice(0, 500);
    } else if (!row.replied_at) {
      // تسجيل أول رد ذرّياً للقياس فقط. لا ينشئ Lead/متابعة/مهمة؛ الفريق يتابع
      // المحادثة داخل هاتف، والتحويل إلى نظامنا يحتاج إشارة عمل صريحة.
      await db.from('whatsapp_campaign_sends')
        .update({ replied_at: when, reply_body: body ? String(body).slice(0, 500) : null, reply_is_auto: false })
        .eq('id', row.id).is('replied_at', null);
    }
    // إسناد المحادثة في هاتف على أول رد (آلي أو حقيقي) داخل نافذة الـ3 أيام — مرة واحدة.
    if (!row.hatif_assigned_at && within3d) {
      try {
        let hatifUserId: string | null = null;
        const { data: cfgRow } = await db.from('app_settings').select('value').eq('key', 'whatsapp_config').maybeSingle();
        if (cfgRow?.value && row.template_name) hatifUserId = (JSON.parse(cfgRow.value).templateAgents || {})[row.template_name] || null;
        if (!hatifUserId && row.sent_by && row.sent_by.length > 20) {
          const { data: prof } = await db.from('profiles').select('hatif_user_id').eq('id', row.sent_by).maybeSingle();
          hatifUserId = prof?.hatif_user_id || null;
        }
        const convId = conversationId || row.conversation_id;
        if (hatifUserId && convId) {
          const tok = await accessToken();
          const ar = await fetch(`https://api.voxa.sa/v2/conversations/service-account/${convId}/assign`, {
            method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
            body: JSON.stringify({ assignedUserId: hatifUserId }),
          });
          if (ar.ok) patch.hatif_assigned_at = when;
          else console.error('assign conversation http', ar.status);
        }
      } catch (e) { console.error('assign conversation failed:', (e as Error).message); }
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

  return ok();
});
