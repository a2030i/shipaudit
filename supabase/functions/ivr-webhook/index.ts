// ivr-webhook v3 (2026-07-22) — يستقبل نتيجة مكالمة IVR من Voxa/Hatif ويحدّث ivr_calls،
// ثم ينفّذ الإجراء المرتبط بالضغطة (press→action) + أتمتة القوالب:
//   press→action: followup/callback → متابعة+مهمة · dnc → حظر اتصال
//   press→template: ضغطة معيّنة → قالب واتساب فوري (مثل رابط سداد)
//   answer→template: إن رُدّ على المكالمة → قالب واتساب تلقائياً (script.onAnswerTemplate)
// Voxa يرسل status/result أرقاماً؛ الإشارات الموثوقة = pressedDigit + answeredAt.
// verify_jwt=false — الحماية ?key= ضد zoho_auth.webhook_key.
import { createClient } from 'npm:@supabase/supabase-js@2';

const svc = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const env = (...n: string[]) => { for (const k of n) { const v = Deno.env.get(k); if (v && v.trim()) return v.trim(); } return ''; };

function norm(raw: unknown) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('966')) return d;
  if (d.length === 10 && d.startsWith('05')) return '966' + d.slice(1);
  if (d.length === 9 && d.startsWith('5')) return '966' + d;
  return d;
}

// ── إرسال قالب واتساب (لأتمتة الرد/الضغطة) — نفس نمط hatif-send ──
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
let channelCache: { id: string; exp: number } | null = null;
async function getChannelId(token: string) {
  const fixed = env('hatif_channel_id', 'HATIF_CHANNEL_ID');
  if (fixed) return fixed;
  if (channelCache && channelCache.exp > Date.now()) return channelCache.id;
  const r = await fetch('https://api.voxa.sa/v1/channels/service-account', { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  const id = (Array.isArray(j.items) ? j.items : [])[0]?.id || '';
  if (id) channelCache = { id, exp: Date.now() + 3600_000 };
  return id;
}
async function sendTemplate(db: ReturnType<typeof svc>, phone: string, name: string | null, templateName: string, campaign: string) {
  // حارس: لا نراسل رقماً محظوراً/بلا واتساب
  try {
    const { data: bl } = await db.from('campaign_phone_blocklist').select('phone').eq('phone', phone).maybeSingle();
    if (bl) return { ok: false, skipped: true };
  } catch { /* */ }
  const token = await accessToken();
  const channelId = await getChannelId(token);
  if (!channelId) return { ok: false, error: 'no channel' };
  const payload = { ChannelId: channelId, TemplateName: templateName, Language: 'ar', ToNumber: phone,
    Parameters: name ? [{ Type: 'Body', Values: [{ Type: 'text', Text: String(name) }] }] : [] };
  const r = await fetch('https://api.voxa.sa/v1/whatsapp/service-account/sendTemplate', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  const okSend = r.ok && (j.status === 'accepted' || !!j.contactId || !!j.conversationEventId);
  if (okSend) {
    try { await db.from('whatsapp_campaign_sends').insert({
      phone, name: name || null, template_name: templateName, channel_id: channelId,
      contact_id: j.contactId || null, conversation_id: j.conversationId || null, message_id: j.conversationEventId || j.contactId || null,
      campaign_name: campaign, status: j.status || 'accepted', sent_at: new Date().toISOString(), sent_by: null,
    }); } catch { /* */ }
  }
  return { ok: okSend, error: okSend ? null : (j.message || j.title || `http ${r.status}`) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  const db = svc();
  const url = new URL(req.url);
  const key = url.searchParams.get('key') || '';
  const { data: za } = await db.from('zoho_auth').select('webhook_key').eq('id', 1).maybeSingle();
  if (!za?.webhook_key || key !== za.webhook_key) return new Response('forbidden', { status: 403 });

  let p: Record<string, any> = {};
  try { p = await req.json(); } catch { return ok(); }

  const externalId = p.externalId || p.ExternalId || null;
  const voxaCallId = p.callId || p.CallId || p.id || p.Id || null;
  const status     = p.status || p.Status || null;
  const result     = p.result || p.Result || null;
  const pressed    = (p.pressedDigit ?? p.PressedDigit ?? null);
  const answered   = !!(p.answeredAt || p.AnsweredAt);
  if (!externalId && !voxaCallId) return ok();

  const SEL = 'id, phone, name, script_key, initiated_by, pressed_digit, action_taken, template_sent_at, attempt, max_attempts, retry_fields, campaign_name';
  let row: Record<string, any> | null = null;
  if (externalId) { const { data } = await db.from('ivr_calls').select(SEL).eq('external_id', externalId).limit(1); row = data?.[0] || null; }
  if (!row && voxaCallId) { const { data } = await db.from('ivr_calls').select(SEL).eq('voxa_call_id', voxaCallId).limit(1); row = data?.[0] || null; }
  if (!row) return ok();

  const patch: Record<string, any> = { raw: p };
  if (status)     patch.status = String(status);
  if (result)     patch.result = String(result);
  if (pressed != null && pressed !== '') patch.pressed_digit = String(pressed);
  if (voxaCallId) patch.voxa_call_id = String(voxaCallId);
  if (p.callDurationSeconds != null) patch.duration_seconds = Number(p.callDurationSeconds) || null;
  if (p.errorMessage) patch.error_message = String(p.errorMessage).slice(0, 300);
  if (p.hangupCause)  patch.hangup_cause = String(p.hangupCause).slice(0, 120);
  for (const [src, col] of [['initiatedAt', 'initiated_at'], ['ringingAt', 'ringing_at'], ['answeredAt', 'answered_at'], ['completedAt', 'completed_at']] as [string, string][]) {
    if (p[src]) patch[col] = p[src];
  }

  const DTMF = /^[0-9*#]$/;
  const digit: string | null = (pressed != null && DTMF.test(String(pressed))) ? String(pressed) : null;

  // نحمّل السكربت مرة إن احتجناه (press→action أو أتمتة القوالب)
  let script: Record<string, any> | null = null;
  if (digit || answered) {
    try {
      const { data: cfgRow } = await db.from('app_settings').select('value').eq('key', 'ivr_config').maybeSingle();
      const cfg = cfgRow?.value ? JSON.parse(cfgRow.value) : {};
      script = (Array.isArray(cfg.scripts) ? cfg.scripts : []).find((s: Record<string, any>) => s.key === row!.script_key) || null;
    } catch { /* */ }
  }
  const opt = (script && digit && Array.isArray(script.options)) ? script.options.find((o: Record<string, any>) => String(o.digit) === digit) : null;
  const owner = (row.initiated_by && String(row.initiated_by).length > 20) ? row.initiated_by : null;
  const when = new Date().toISOString();

  // ── press→action (مرة واحدة) ──
  if (digit && !row.action_taken) {
    try {
      const action = opt?.action || 'none';
      if (action === 'followup' || action === 'callback') {
        if (row.phone) {
          const { data: fu } = await db.from('retargeting_followups').select('phone, status, owner_id').eq('phone', row.phone).maybeSingle();
          const FINAL = new Set(['converted', 'returned', 'supplier', 'noise', 'blacklist', 'test']);
          if (!fu || !FINAL.has(fu.status)) {
            await db.from('retargeting_followups').upsert({ phone: row.phone, status: 'needs_followup', owner_id: fu?.owner_id ?? owner, last_touch_at: when, updated_at: when }, { onConflict: 'phone' });
          }
          const assignee = (fu?.owner_id ?? owner);
          if (assignee) {
            const title = action === 'callback'
              ? `📞 طلب معاودة اتصال من ${row.name || row.phone} (ضغط ${digit})`
              : `📞 ${row.name || row.phone} ضغط ${digit} في مكالمة آلية — تابِعه`;
            await db.from('crm_tasks').insert({ title, kind: 'followup', entity_type: 'retargeting', entity_ref: row.phone, assigned_to: assignee, due_at: when, priority: 'high', status: 'open' });
          }
        }
      } else if (action === 'dnc') {
        if (row.phone) await db.from('campaign_phone_blocklist').upsert({ phone: row.phone, name: row.name || null, reason: 'طلب إيقاف الاتصالات (IVR)', added_at: when }, { onConflict: 'phone' });
      }
      patch.action_taken = action;
    } catch (e) { console.error('ivr press→action failed:', (e as Error).message); }
  }

  // ── أتمتة القوالب (مرة واحدة): ضغطة→قالب تتقدّم، وإلا رَدّ→قالب ──
  if (!row.template_sent_at && row.phone && script) {
    const tpl = (opt?.template && String(opt.template).trim())
      ? String(opt.template).trim()
      : (answered && script.onAnswerTemplate && String(script.onAnswerTemplate).trim() ? String(script.onAnswerTemplate).trim() : '');
    if (tpl) {
      try {
        const res = await sendTemplate(db, row.phone, row.name || null, tpl, `IVR: ${row.script_key || ''}`);
        if (res.ok || res.skipped) patch.template_sent_at = when;
      } catch (e) { console.error('ivr answer/press→template failed:', (e as Error).message); }
    }
  }

  // ── إعادة المحاولة على «لم يُردّ» (غير مُجاب) — تُدرَج في الطابور بعد afterHours ──
  if (!answered && Number(row.attempt || 1) < Number(row.max_attempts || 1)) {
    try {
      let retry: Record<string, any> | null = null;
      const { data: cfgRow } = await db.from('app_settings').select('value').eq('key', 'ivr_config').maybeSingle();
      try { retry = cfgRow?.value ? JSON.parse(cfgRow.value).retry : null; } catch { /* */ }
      if (retry?.enabled) {
        const runAt = new Date(Date.now() + (Number(retry.afterHours) || 3) * 3600 * 1000).toISOString();
        await db.from('ivr_queue').insert({
          phone: row.phone, name: row.name, fields: row.retry_fields, script_key: row.script_key,
          campaign_name: row.campaign_name, run_at: runAt, status: 'queued',
          attempts: Number(row.attempt || 1), max_attempts: Number(row.max_attempts || 1), created_by: row.initiated_by,
        });
      }
    } catch (e) { console.error('ivr retry enqueue failed:', (e as Error).message); }
  }

  if (Object.keys(patch).length) { try { await db.from('ivr_calls').update(patch).eq('id', row.id); } catch { /* */ } }
  return ok();
});
