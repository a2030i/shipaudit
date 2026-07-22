// ivr-runner v1 (2026-07-22) — cron: يعالج طابور المكالمات المجدولة/المُعاد محاولتها.
// يحترم **ساعات الاتصال** (نافذة KSA من ivr_config.callHours) فلا يتصل ليلاً، ويطلق
// المكالمات المستحقّة (run_at<=now) عبر Voxa. إعادة المحاولة تُدرِجها ivr-webhook.
// الأمان: X-Cron-Key ضد zoho_auth.cron_key (نمط campaign-runner/morning-brief).
import { createClient } from 'npm:@supabase/supabase-js@2';

const svc = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const env = (...n: string[]) => { for (const k of n) { const v = Deno.env.get(k); if (v && v.trim()) return v.trim(); } return ''; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function norm(raw: unknown) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('966')) return d;
  if (d.length === 10 && d.startsWith('05')) return '966' + d.slice(1);
  if (d.length === 9 && d.startsWith('5')) return '966' + d;
  return d;
}
async function accessToken() {
  const id = env('client_id', 'HATIF_CLIENT_ID'), secret = env('secret', 'HATIF_CLIENT_SECRET');
  if (!id || !secret) throw new Error('no hatif secrets');
  const r = await fetch('https://api.voxa.sa/connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret, scope: 'VoxaAPI' }) });
  const j = await r.json(); if (!j.access_token) throw new Error('token failed'); return j.access_token as string;
}
async function getChannelId(token: string, cfgChannel: string) {
  const fixed = env('hatif_channel_id', 'HATIF_CHANNEL_ID'); if (fixed) return fixed;
  if (cfgChannel) return cfgChannel;
  const r = await fetch('https://api.voxa.sa/v1/channels/service-account', { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({})); return (Array.isArray(j.items) ? j.items : [])[0]?.id || '';
}
function fillTts(tpl: string, name: string | null, fields: Record<string, unknown> | null) {
  const f = fields || {}; const map: Record<string, string> = { name: name || String(f.name || ''), 'اسم': name || String(f.name || '') };
  for (const [k, v] of Object.entries(f)) map[k] = String(v ?? '');
  const alias: Record<string, string> = { amount: 'amount', 'مبلغ': 'amount' };
  return String(tpl || '').replace(/\{([^}]+)\}/g, (_m, key) => { const k = String(key).trim(); if (map[k] != null && map[k] !== '') return map[k]; const a = alias[k]; if (a && map[a] != null) return map[a]; return ''; }).replace(/\s{2,}/g, ' ').trim();
}

Deno.serve(async (req) => {
  const db = svc();
  const { data: za } = await db.from('zoho_auth').select('cron_key, webhook_key').eq('id', 1).maybeSingle();
  const cronKey = req.headers.get('X-Cron-Key') || new URL(req.url).searchParams.get('key') || '';
  if (!za?.cron_key || cronKey !== za.cron_key) return new Response('forbidden', { status: 403 });

  const { data: cfgRow } = await db.from('app_settings').select('value').eq('key', 'ivr_config').maybeSingle();
  let cfg: Record<string, any> = {}; try { cfg = cfgRow?.value ? JSON.parse(cfgRow.value) : {}; } catch { /* */ }
  if (cfg.enabled === false) return json({ ok: true, skipped: 'disabled' });

  // ساعات الاتصال بتوقيت السعودية (UTC+3) — لا نتصل خارج النافذة
  const h = (new Date().getUTCHours() + 3) % 24;
  const start = Number(cfg.callHours?.start ?? 9), end = Number(cfg.callHours?.end ?? 21);
  const within = start <= end ? (h >= start && h < end) : (h >= start || h < end);
  if (!within) return json({ ok: true, skipped: 'outside_hours', hour_ksa: h });

  const { data: due } = await db.from('ivr_queue').select('*').eq('status', 'queued').lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true }).limit(60);
  if (!due?.length) return json({ ok: true, placed: 0, note: 'no due' });

  const scripts = Array.isArray(cfg.scripts) ? cfg.scripts : [];
  let token = ''; try { token = await accessToken(); } catch (e) { return json({ ok: false, error: String((e as Error).message || e) }); }
  const channelId = await getChannelId(token, String(cfg.channelId || ''));
  if (!channelId) return json({ ok: false, error: 'no channel' });
  const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/ivr-webhook?key=${encodeURIComponent(za.webhook_key || '')}`;
  const ttsVoice = (cfg.ttsVoice === 'Male' || cfg.ttsVoice === 'Female') ? cfg.ttsVoice : 'Female';
  const blocked = new Set<string>();
  try { const { data: bl } = await db.from('campaign_phone_blocklist').select('phone'); for (const r of (bl || []) as { phone: string }[]) if (r.phone) blocked.add(norm(r.phone)); } catch { /* */ }

  const t0 = Date.now(); let placed = 0, failed = 0, skipped = 0;
  for (const q of due) {
    if (Date.now() - t0 > 120000) break;   // ميزانية وقت
    const to = norm(q.phone);
    if (!to || to.length < 11) { await db.from('ivr_queue').update({ status: 'failed', last_result: 'bad_phone' }).eq('id', q.id); failed++; continue; }
    if (blocked.has(to)) { await db.from('ivr_queue').update({ status: 'cancelled', last_result: 'blocked' }).eq('id', q.id); skipped++; continue; }
    const script = scripts.find((s: Record<string, any>) => s.key === q.script_key) || scripts.find((s: Record<string, any>) => s.key === cfg.defaultScript) || scripts[0];
    if (!script) { await db.from('ivr_queue').update({ status: 'failed', last_result: 'no_script' }).eq('id', q.id); failed++; continue; }
    const options = Array.isArray(script.options) ? script.options : [];
    if (!options.length) { await db.from('ivr_queue').update({ status: 'failed', last_result: 'no_options' }).eq('id', q.id); failed++; continue; }

    await db.from('ivr_queue').update({ status: 'sending' }).eq('id', q.id);
    const audioUrl = String(script.audioUrl || '').trim();
    const ttsText = fillTts(String(script.ttsText || ''), q.name, q.fields);
    const attempt = (Number(q.attempts) || 0) + 1;
    const maxAtt = Number(q.max_attempts) || 1;

    const { data: ins } = await db.from('ivr_calls').insert({
      phone: to, name: q.name || null, campaign_name: q.campaign_name, script_key: script.key,
      tts_text: ttsText, channel_id: channelId, status: 'pending', initiated_by: q.created_by,
      attempt, max_attempts: maxAtt, retry_fields: q.fields || null,
    }).select('id').single();
    const callRowId = ins?.id;
    if (callRowId) await db.from('ivr_calls').update({ external_id: callRowId }).eq('id', callRowId);

    try {
      const payload: Record<string, unknown> = { channelId, destinationNumber: to, externalId: callRowId, webhookUrl, ttsVoice,
        options: options.map((o: Record<string, any>) => ({ Digit: String(o.digit), Description: String(o.description || o.digit) })),
        maxAudioRetries: Number(cfg.maxAudioRetries ?? 2), inputTimeoutMs: Number(cfg.inputTimeoutMs ?? 6000), digitTimeoutMs: Number(cfg.digitTimeoutMs ?? 3000) };
      if (audioUrl) payload.audioFileUrl = audioUrl; else payload.ttsText = ttsText;
      const successUrl = String(script.successAudioUrl || '').trim(); if (successUrl) payload.successMessageFileUrl = successUrl;
      const vr = await fetch('https://api.voxa.sa/v1/outbound-ivr', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      if (vr.ok) {
        const vj = await vr.json().catch(() => ({}));
        if (callRowId) await db.from('ivr_calls').update({ voxa_call_id: vj.callId || vj.id || null, status: vj.status || 'InProgress' }).eq('id', callRowId);
        await db.from('ivr_queue').update({ status: 'done', attempts: attempt, ivr_call_id: callRowId, last_result: 'placed' }).eq('id', q.id);
        placed++;
      } else {
        const vj = await vr.json().catch(() => ({}));
        if (callRowId) await db.from('ivr_calls').update({ status: 'Failed', error_message: String(vj.message || vr.status).slice(0, 200) }).eq('id', callRowId);
        await db.from('ivr_queue').update({ status: 'failed', attempts: attempt, last_result: `http ${vr.status}` }).eq('id', q.id);
        failed++;
      }
    } catch (e) {
      await db.from('ivr_queue').update({ status: 'failed', attempts: attempt, last_result: String((e as Error).message || e).slice(0, 100) }).eq('id', q.id);
      failed++;
    }
    await sleep(400);
  }
  return json({ ok: true, placed, failed, skipped, hour_ksa: h });
});
