// hatif-ivr v1 (2026-07-22) — إطلاق مكالمات آلية (Outbound IVR) عبر Voxa/Hatif.
// POST api.voxa.sa/v1/outbound-ivr لكل مستلِم — يشتغل صوتياً (TTS) ويقرأ ضغطة العميل
// (DTMF) ثم يرسل نتيجة المكالمة إلى ivr-webhook. مصمَّم أساساً للعملاء **بلا واتساب**.
// الأسرار: client_id · secret (VoxaAPI scope). القناة تُجلَب آلياً (نمط hatif-send).
// الحارس السيرفري: campaigns.ivr (حسّاس). الحظر = campaign_phone_blocklist فقط
// (لا نُطبّق مجموعة بلا-واتساب — هؤلاء بالضبط هدف الاتصال الصوتي).
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
const IVR_URL = 'https://api.voxa.sa/v1/outbound-ivr';
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

// نطق عدد صحيح بالعربي (0..999999) — لتوضيح المبالغ في TTS
const AR_ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const AR_TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const AR_HUND = ['', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'];
function arBelow1000(x: number): string { const p: string[] = []; const h = Math.floor(x / 100), r = x % 100; if (h) p.push(AR_HUND[h]); if (r) { if (r < 20) p.push(AR_ONES[r]); else { const t = Math.floor(r / 10), o = r % 10; p.push(o ? AR_ONES[o] + ' و' + AR_TENS[t] : AR_TENS[t]); } } return p.join(' و'); }
function arNum(nRaw: unknown): string {
  const n = Math.round(Math.abs(Number(nRaw) || 0)); if (n === 0) return 'صفر';
  const p: string[] = []; const th = Math.floor(n / 1000), r = n % 1000;
  if (th) { if (th === 1) p.push('ألف'); else if (th === 2) p.push('ألفان'); else if (th <= 10) p.push(arBelow1000(th) + ' آلاف'); else p.push(arBelow1000(th) + ' ألف'); }
  if (r) p.push(arBelow1000(r));
  return p.join(' و');
}
const AMOUNT_KEYS = new Set(['amount', 'overdue', 'wallet', 'debt', 'مبلغ']);

// ملء متغيّرات السكربت الصوتي من حقول المستلِم — {name}/{اسم}, {amount}/{مبلغ}, {أي حقل}.
function fillTts(tpl: string, r: { name?: string; fields?: Record<string, unknown> }, speakWords = false) {
  const f = r.fields || {};
  const num = (k: string, v: unknown) => (speakWords && AMOUNT_KEYS.has(k) && v !== '' && v != null && Number.isFinite(Number(v))) ? arNum(v) + ' ريال' : String(v ?? '');
  const map: Record<string, string> = {
    name: r.name || String(f.name || f['اسم'] || ''), 'اسم': r.name || String(f.name || f['اسم'] || ''),
  };
  for (const [k, v] of Object.entries(f)) map[k] = num(k, v);
  const alias: Record<string, string> = { amount: 'amount', 'مبلغ': 'amount', debt: 'amount' };
  return String(tpl || '').replace(/\{([^}]+)\}/g, (_m, key) => {
    const k = String(key).trim();
    if (map[k] != null && map[k] !== '') return map[k];
    const a = alias[k]; if (a && map[a] != null) return map[a];
    return '';
  }).replace(/\s{2,}/g, ' ').trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const db = svc();
  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* */ }
  const action = String(body.action || url.searchParams.get('action') || 'status');

  const auth = await requireUser(req, db);
  if (!auth) return json({ error: 'unauthorized — سجّل دخولك' }, 401);
  const allowed = auth.role === 'admin' || auth.permissions?.['campaigns.ivr'] === true;
  if (!allowed) return json({ error: 'forbidden — تحتاج صلاحية «إطلاق مكالمات آلية IVR»' }, 403);

  if (action === 'verify') {
    try { await accessToken(); return json({ ok: true, provider: 'hatif-ivr' }); }
    catch (e) { return json({ ok: false, error: String((e as Error).message || e) }); }
  }

  if (action === 'channels') {
    try {
      const t = await accessToken();
      const items = await fetchChannels(t);
      return json({ ok: true, channels: items.map((c: Record<string, any>) => ({ id: c.id, name: c.name, number: c.phoneNumber?.number || null })) });
    } catch (e) { return json({ ok: false, error: String((e as Error).message || e) }); }
  }

  if (action === 'call') {
    const recipients = Array.isArray(body.recipients) ? body.recipients as { phone: string; name?: string; fields?: Record<string, unknown> }[] : [];
    const scriptKey = String(body.script_key || '');
    const campaignName = String(body.campaign_name || '') || null;
    if (!recipients.length) return json({ ok: false, error: 'لا مستلمين' });

    // الإعدادات + السكربت
    const { data: cfgRow } = await db.from('app_settings').select('value').eq('key', 'ivr_config').maybeSingle();
    let cfg: Record<string, any> = {};
    try { cfg = cfgRow?.value ? JSON.parse(cfgRow.value) : {}; } catch { cfg = {}; }
    if (cfg.enabled === false) return json({ ok: false, error: 'مكالمات IVR غير مُفعَّلة — فعّلها من الإعدادات' });
    const scripts = Array.isArray(cfg.scripts) ? cfg.scripts : [];
    const script = scripts.find((s: Record<string, any>) => s.key === (scriptKey || cfg.defaultScript)) || scripts[0];
    if (!script) return json({ ok: false, error: 'لا يوجد سكربت صوتي مُعرَّف' });
    const options = Array.isArray(script.options) ? script.options : [];
    if (!options.length) return json({ ok: false, error: 'السكربت بلا خيارات (options) — Voxa يتطلّب خياراً واحداً على الأقل' });

    let token: string;
    try { token = await accessToken(); } catch (e) { return json({ ok: false, error: String((e as Error).message || e) }); }
    let channelId = String(body.channel_id || cfg.channelId || '');
    if (!channelId) { try { channelId = await getChannelId(token); } catch { /* */ } }
    if (!channelId) return json({ ok: false, error: 'لا قناة متاحة — ثبّت HATIF_CHANNEL_ID أو راجع قنوات Hatif' });

    // حظر الاتصال — القائمة اليدوية فقط (تشمل رقم المالك). لا نُطبّق بلا-واتساب.
    const blocked = new Set<string>();
    try { const { data: bl } = await db.from('campaign_phone_blocklist').select('phone'); for (const r of (bl || []) as { phone: string }[]) if (r.phone) blocked.add(norm(r.phone)); } catch { /* */ }

    const webhookKey = (await db.from('zoho_auth').select('webhook_key').eq('id', 1).maybeSingle()).data?.webhook_key || '';
    const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/ivr-webhook?key=${encodeURIComponent(webhookKey)}`;
    const voxaOptions = options.map((o: Record<string, any>) => {
      const opt: Record<string, unknown> = { Digit: String(o.digit), Description: String(o.description || o.digit) };
      if (o.responseAudioUrl && String(o.responseAudioUrl).trim()) opt.ResponseMessageFileUrl = String(o.responseAudioUrl).trim();
      return opt;
    });
    const ttsVoice = (cfg.ttsVoice === 'Male' || cfg.ttsVoice === 'Female') ? cfg.ttsVoice : 'Female';

    const results: unknown[] = []; let placed = 0, failed = 0, skipped = 0;
    for (const r of recipients) {
      const to = norm(r.phone);
      if (!to || to.length < 11) { results.push({ phone: r.phone, ok: false, error: 'رقم غير صالح' }); failed++; continue; }
      if (blocked.has(to)) { results.push({ phone: to, ok: false, skipped: true, error: 'محظور — لا يُتَّصل به' }); skipped++; continue; }
      const ttsText = fillTts(String(body.tts_override || script.ttsText || ''), r, cfg.speakNumbersWords === true);
      // صوت مرفوع أو نص منطوق — أحدهما مطلوب
      if (!ttsText && !String(script.audioUrl || '').trim()) { results.push({ phone: to, ok: false, error: 'لا صوت ولا نص للمكالمة' }); failed++; continue; }

      // سجّل الصف أولاً — id يصير externalId (idempotency)
      const retryOn = cfg.retry?.enabled === true;
      const { data: ins, error: insErr } = await db.from('ivr_calls').insert({
        phone: to, name: r.name || null, campaign_name: campaignName, script_key: script.key,
        tts_text: ttsText, channel_id: channelId, status: 'pending', initiated_by: auth.id,
        attempt: 1, max_attempts: retryOn ? (Number(cfg.retry?.maxAttempts) || 2) : 1, retry_fields: r.fields || null,
      }).select('id').single();
      if (insErr || !ins?.id) { results.push({ phone: to, ok: false, error: 'فشل تسجيل المكالمة' }); failed++; continue; }
      const callRowId = ins.id;
      await db.from('ivr_calls').update({ external_id: callRowId }).eq('id', callRowId);

      try {
        // صوت مرفوع (WAV) يتقدّم على TTS — أحدهما يكفي Voxa.
        const audioUrl = String(script.audioUrl || '').trim();
        const payload: Record<string, unknown> = {
          channelId, destinationNumber: to, externalId: callRowId, webhookUrl,
          ttsVoice, options: voxaOptions,
          maxAudioRetries: Number(cfg.maxAudioRetries ?? 2),
          inputTimeoutMs: Number(cfg.inputTimeoutMs ?? 6000),
          digitTimeoutMs: Number(cfg.digitTimeoutMs ?? 3000),
        };
        if (audioUrl) payload.audioFileUrl = audioUrl; else payload.ttsText = ttsText;
        // رسالة ختام (WAV) تُشغَّل بعد ضغطة صحيحة ثم يُقفل — «شكراً لك»
        const successUrl = String(script.successAudioUrl || '').trim();
        if (successUrl) payload.successMessageFileUrl = successUrl;
        const vr = await fetch(IVR_URL, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        const vj = await vr.json().catch(() => ({}));
        if (vr.ok) {
          placed++;
          await db.from('ivr_calls').update({ voxa_call_id: vj.callId || vj.id || null, status: vj.status || 'InProgress' }).eq('id', callRowId);
          results.push({ phone: to, ok: true, id: callRowId });
        } else {
          failed++;
          const err = vj.message || vj.title || vj.error || `http ${vr.status}`;
          await db.from('ivr_calls').update({ status: 'Failed', error_message: String(err).slice(0, 300) }).eq('id', callRowId);
          results.push({ phone: to, ok: false, error: err });
        }
      } catch (e) {
        failed++;
        await db.from('ivr_calls').update({ status: 'Failed', error_message: String((e as Error).message || e).slice(0, 300) }).eq('id', callRowId);
        results.push({ phone: to, ok: false, error: String((e as Error).message || e) });
      }
      await sleep(400);   // تحت حصة Voxa
    }
    return json({ ok: true, total: recipients.length, placed, failed, skipped, results, provider: 'hatif-ivr' });
  }

  return json({ error: 'unknown action (verify|channels|call)' }, 400);
});
