// hatif-send v15 — إرسال واتساب عبر Hatif/Voxa (بديل Respondly).
// v15 (2026-07-22): إجراءان admin: hatif_users (سرد موظفي الـWorkspace) +
// sync_hatif_users (ربط profiles.email بموظف هاتف → hatif_user_id للإسناد الآلي).
// v14 (2026-07-21): **حارس قائمة الحظر السيرفري** — أي رقم في مجموعة
// no_whatsapp_phones() (= undeliverable ∪ campaign_phone_blocklist، يشمل رقم
// المالك الشخصي) يُتخطّى في كل مسار إرسال بلا استثناء (فوري/مجدول/drip)، حتى
// لو تسلّل عبر الـdrip الذي يتجاوز استبعاد المودال. الرقم المحظور لا يُراسَل
// أبداً ولا يُسجَّل كإرسال — يُعاد كنتيجة skipped.
// v13 (2026-07-21): حُذف إجراء explore المؤقت (كان بروكسي GET مفتوحاً على
// api.voxa.sa بمفتاح الـwebhook — أُزيل بعد استرجاع سجل حملة الـ504).
// v10 (2026-07-21): مهلة 350ms بين الرسائل (~170/دقيقة أقصى — تحت حصة Voxa).
// v11 (2026-07-21): **تسجيل فوري رسالة-برسالة** — الإدراج الواحد في النهاية ضاع
// كاملاً حين قتلت المهلة (504) استدعاءً بـ290 مستلماً: ~120 رسالة خرجت فعلاً
// (أكّدتها إشعارات الـwebhook) بلا أي صف سجل. الآن كل نجاح يُسجَّل لحظته،
// فالانقطاع يترك سجلاً دقيقاً ويتيح الاستئناف عبر «استثناء من حملات سابقة».
// نفس واجهة whatsapp-send: action verify|send + template_name/template_language/
// channel_id + items:[{to, vars[]}] — فيعمل التطبيق دون تغيير. الأسرار:
// client_id · secret (أو HATIF_CLIENT_ID/SECRET). التوكن client-credentials مع كاش.
// إرسال قالب: POST api.voxa.sa/v1/whatsapp/service-account/sendTemplate.
import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_ORIGIN = 'https://shipaudit-five.vercel.app';
const CORS = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const svc = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const env = (...names: string[]) => { for (const n of names) { const v = Deno.env.get(n); if (v && v.trim()) return v.trim(); } return ''; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const TOKEN_URL = 'https://api.voxa.sa/connect/token';
const SEND_URL  = 'https://api.voxa.sa/v1/whatsapp/service-account/sendTemplate';
const CHANNELS_URL = 'https://api.voxa.sa/v1/channels/service-account';

function norm(raw: unknown) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('966')) return d;
  if (d.length === 10 && d.startsWith('05')) return '966' + d.slice(1);
  if (d.length === 9 && d.startsWith('5')) return '966' + d;
  return d;
}

let tokenCache: { token: string; exp: number } | null = null;
async function accessToken() {
  if (tokenCache && tokenCache.exp > Date.now()) return tokenCache.token;
  const id = env('client_id', 'HATIF_CLIENT_ID'), secret = env('secret', 'HATIF_CLIENT_SECRET');
  if (!id || !secret) throw new Error('أسرار Hatif غير مضبوطة (client_id/secret)');
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret, scope: 'VoxaAPI' }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('token failed: ' + JSON.stringify(j));
  tokenCache = { token: j.access_token, exp: Date.now() + ((Number(j.expires_in) || 3600) * 1000) - 60000 };
  return tokenCache.token;
}

// جلب القنوات — لإلغاء الحاجة لإدخال ChannelId يدوياً.
let channelCache: { id: string; exp: number } | null = null;
async function fetchChannels(token: string) {
  const r = await fetch(CHANNELS_URL, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  return Array.isArray(j.items) ? j.items : [];
}
async function getChannelId(token: string) {
  const fixed = env('hatif_channel_id', 'HATIF_CHANNEL_ID');
  if (fixed) return fixed;
  if (channelCache && channelCache.exp > Date.now()) return channelCache.id;
  const items = await fetchChannels(token);
  const id = items[0]?.id || '';
  if (id) channelCache = { id, exp: Date.now() + 3600_000 };
  return id;
}

async function requireUser(req: Request, db: ReturnType<typeof svc>) {
  const authHeader = req.headers.get('Authorization') || '';
  const uc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await uc.auth.getUser();
  if (!user) return null;
  const { data: p } = await db.from('profiles').select('role, permissions').eq('id', user.id).maybeSingle();
  return { id: user.id, role: p?.role || null, permissions: p?.permissions || {} };
}

async function sendTemplate(token: string, o: { channelId: string; templateName: string; language: string; to: string; vars: unknown[] }) {
  const payload = {
    ChannelId: o.channelId, TemplateName: o.templateName, Language: o.language || 'ar', ToNumber: o.to,
    Parameters: (o.vars && o.vars.length)
      ? [{ Type: 'Body', Values: o.vars.map(v => ({ Type: 'text', Text: String(v ?? '') })) }]
      : [],
  };
  const r = await fetch(SEND_URL, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  const ok = r.ok && (j.status === 'accepted' || !!j.contactId || !!j.conversationEventId);
  return { ok, id: j.conversationEventId || j.contactId || null, contactId: j.contactId || null, conversationId: j.conversationId || null,
           status: j.status || null, error: ok ? null : (j.message || j.title || j.error || `http ${r.status}`) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const db = svc();
  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* */ }
  const action = String(body.action || url.searchParams.get('action') || 'status');

  // probe (توكن فقط) — محمي بـ ?key= للفحص أثناء الإعداد
  if (action === 'probe') {
    const key = url.searchParams.get('key') || '';
    const { data: za } = await db.from('zoho_auth').select('webhook_key').eq('id', 1).maybeSingle();
    if (!za?.webhook_key || key !== za.webhook_key) return new Response('forbidden', { status: 403 });
    try { const t = await accessToken(); return json({ ok: !!t, token_len: t.length }); }
    catch (e) { return json({ ok: false, error: String((e as Error).message || e) }); }
  }

  const auth = await requireUser(req, db);
  if (!auth) return json({ error: 'unauthorized — سجّل دخولك' }, 401);
  // صلاحيات v2: الإرسال الفعلي = campaigns.send حصراً (backfill منحها لمن كان
  // يملك collections.view/crm.view). الفحص هنا هو الحدّ الفعلي لا الواجهة.
  const allowed = auth.role === 'admin' || auth.permissions?.['campaigns.send'] === true;
  if (!allowed) return json({ error: 'forbidden — تحتاج صلاحية «إطلاق حملة واتساب»' }, 403);

  if (action === 'verify') {
    try { await accessToken(); return json({ ok: true, provider: 'hatif' }); }
    catch (e) { return json({ ok: false, error: String((e as Error).message || e) }); }
  }

  if (action === 'channels') {
    try {
      const t = await accessToken();
      const items = await fetchChannels(t);
      return json({ ok: true, channels: items.map((c: Record<string, any>) => ({ id: c.id, name: c.name, number: c.phoneNumber?.number || null })) });
    } catch (e) { return json({ ok: false, error: String((e as Error).message || e) }); }
  }

  // موظفو هاتف (Workspace) + الربط الآلي بموظفينا بالإيميل — للإسناد التلقائي
  if (action === 'hatif_users' || action === 'sync_hatif_users') {
    if (auth.role !== 'admin') return json({ error: 'forbidden — للمدير فقط' }, 403);
    try {
      const t = await accessToken();
      const r = await fetch('https://api.voxa.sa/v1/workspaces/users', { headers: { Authorization: `Bearer ${t}` } });
      const j = await r.json().catch(() => ({}));
      const users = (Array.isArray(j) ? j : (j.items || [])).filter((u: Record<string, any>) => !u.isAiAgent)
        .map((u: Record<string, any>) => ({ userId: u.userId, name: u.name, email: u.email || null }));
      if (action === 'hatif_users') return json({ ok: true, users });
      // sync: طابِق profiles.email = user.email (حساس للحالة لا) → اضبط hatif_user_id
      let mapped = 0;
      for (const u of users) {
        if (!u.email || !u.userId) continue;
        const { data: p } = await db.from('profiles').select('id').ilike('email', u.email).maybeSingle();
        if (p?.id) { await db.from('profiles').update({ hatif_user_id: u.userId }).eq('id', p.id); mapped++; }
      }
      return json({ ok: true, users, mapped, total: users.length });
    } catch (e) { return json({ ok: false, error: String((e as Error).message || e) }); }
  }

  if (action === 'send') {
    const items = Array.isArray(body.items) ? body.items as { to: string; vars?: unknown[] }[] : [];
    const templateName = String(body.template_name || '');
    const language = String(body.template_language || 'ar');
    const campaign = (body.campaign && typeof body.campaign === 'object') ? body.campaign as Record<string, unknown> : {};
    if (!templateName) return json({ ok: false, error: 'template_name مطلوب' });
    if (!items.length) return json({ ok: false, error: 'لا مستلمين' });
    let token: string;
    try { token = await accessToken(); } catch (e) { return json({ ok: false, error: String((e as Error).message || e) }); }
    let channelId = String(body.channel_id || '');
    if (!channelId) { try { channelId = await getChannelId(token); } catch { /* */ } }
    if (!channelId) return json({ ok: false, error: 'لا قناة متاحة — ثبّت HATIF_CHANNEL_ID أو راجع قنوات Hatif' });
    // حارس الحظر السيرفري — يُحمَّل مرة واحدة لكل استدعاء (لا لكل رسالة).
    // يشمل بلا-واتساب (undeliverable) + قائمة الحظر اليدوية (رقم المالك).
    const blocked = new Set<string>();
    try {
      const { data: bl, error: blocklistError } = await db.rpc('no_whatsapp_phones');
      if (blocklistError) throw blocklistError;
      for (const r of (bl || []) as { phone: string }[]) if (r.phone) blocked.add(r.phone);
    } catch (e) {
      console.error('campaign blocked: no_whatsapp_phones unavailable', String((e as Error).message || e));
      return json({ ok: false, error: 'تعذّر التحقق من قائمة الحظر — أوقِف الإرسال حفاظاً على العملاء ثم أعد المحاولة' }, 503);
    }
    const results: unknown[] = []; let sent = 0, failed = 0, skipped = 0;
    for (const it of items) {
      const to = norm(it.to);
      if (!to || to.length < 11) { results.push({ to: it.to, ok: false, error: 'رقم غير صالح' }); failed++; continue; }
      if (blocked.has(to)) { results.push({ to, ok: false, skipped: true, error: 'محظور — لا يُراسَل (بلا واتساب/قائمة حظر)' }); skipped++; continue; }
      try {
        const res = await sendTemplate(token, { channelId, templateName, language, to, vars: it.vars || [] });
        if (res.ok) sent++; else failed++;
        results.push({ to, ok: res.ok, id: res.id, error: res.error });
        // تسجيل فوري (v11) — لا تجميع للنهاية: انقطاع المهلة كان يضيع السجل كله
        if (res.ok) { try { await db.from('whatsapp_campaign_sends').insert({
          phone: to, name: (it as Record<string, unknown>).name || null,
          template_name: templateName, channel_id: channelId,
          contact_id: res.contactId, conversation_id: res.conversationId, message_id: res.id,
          campaign_name: campaign.name || null, campaign_bucket: campaign.bucket || null,
          amount: (it as Record<string, unknown>).amount ?? null,
          status: res.status || 'accepted', sent_at: new Date().toISOString(), sent_by: auth.id,
        }); } catch { /* لا يُفشل الإرسال */ } }
      } catch (e) { failed++; results.push({ to, ok: false, error: String((e as Error).message || e) }); }
      await sleep(300);   // مع زمن الإرسال والتسجيل ≈ ثانية/رسالة — تحت حصة Voxa
    }
    return json({ ok: true, total: items.length, sent, failed, skipped, results, provider: 'hatif' });
  }

  return json({ error: 'unknown action (probe|verify|channels|send)' }, 400);
});
