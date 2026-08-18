// Google Sheets / Apps Script -> ShipAudit CRM. Custom HMAC authentication;
// verify_jwt must remain false. This function never calls Zoho.
import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const env = (name: string) => (Deno.env.get(name) || '').trim();

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}
function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function normPhone(raw: unknown) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 && d.startsWith('05')) d = '966' + d.slice(1);
  else if (d.length === 9 && d.startsWith('5')) d = '966' + d;
  return d;
}

async function sendStaffTemplate(result: Record<string, any>) {
  const template = env('HATIF_NEW_LEAD_STAFF_TEMPLATE');
  const clientId = env('HATIF_CLIENT_ID') || env('client_id');
  const secret = env('HATIF_CLIENT_SECRET') || env('secret');
  const channelId = env('HATIF_CHANNEL_ID') || env('hatif_channel_id');
  const to = normPhone(result.assignee_phone);
  if (!template || !clientId || !secret || !channelId || !to) {
    return { sent: false, skipped: true, error: 'staff_notification_not_configured' };
  }
  const tokenRes = await fetch('https://api.voxa.sa/connect/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: secret, scope: 'VoxaAPI' }),
  });
  const tokenJson = await tokenRes.json().catch(() => ({}));
  if (!tokenJson.access_token) return { sent: false, error: 'hatif_token_failed' };
  const leadUrl = `https://shipaudit-five.vercel.app/crm?tab=external&lead=${encodeURIComponent(result.lead_id)}`;
  const vars = [result.lead_name, result.lead_phone, result.city || 'ØºÙŠØ± Ù…Ø­Ø¯Ø¯Ø©',
    result.category || 'ØºÙŠØ± Ù…Ø­Ø¯Ø¯', result.campaign_name || 'Ø­Ù…Ù„Ø© Ø¥Ø¹Ù„Ø§Ù†ÙŠØ©', leadUrl];
  const res = await fetch('https://api.voxa.sa/v1/whatsapp/service-account/sendTemplate', {
    method: 'POST', headers: { Authorization: `Bearer ${tokenJson.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ChannelId: channelId, TemplateName: template, Language: 'ar', ToNumber: to,
      Parameters: [{ Type: 'Body', Values: vars.map(v => ({ Type: 'text', Text: String(v) })) }] }),
  });
  const body = await res.json().catch(() => ({}));
  const ok = res.ok && (body.status === 'accepted' || body.contactId || body.conversationEventId);
  return { sent: !!ok, error: ok ? null : (body.message || body.error || `http_${res.status}`), provider: body };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const raw = await req.text();
  const timestamp = req.headers.get('x-shipaudit-timestamp') || '';
  const signature = (req.headers.get('x-shipaudit-signature') || '').toLowerCase().replace(/^sha256=/, '');
  const secret = env('GOOGLE_LEADS_WEBHOOK_SECRET');
  if (!secret || !timestamp || !signature) return json({ error: 'unauthorized' }, 401);
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60_000) return json({ error: 'stale_request' }, 401);
  const expected = await hmac(secret, `${timestamp}.${raw}`);
  if (!safeEq(signature, expected)) return json({ error: 'invalid_signature' }, 401);

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(raw); } catch { return json({ error: 'invalid_json' }, 400); }
  const eventId = String(payload.event_id || payload.response_id || payload['Ù…Ø¹Ø±Ù Ø§Ù„Ø§Ø³ØªØ¬Ø§Ø¨Ø©'] || '').trim();
  if (!eventId) return json({ error: 'event_id_required' }, 400);
  const payloadHash = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)));
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const { data, error } = await db.rpc('ingest_google_campaign_lead', {
    p_external_event_id: eventId, p_payload_hash: payloadHash, p_payload: payload,
  });
  if (error) return json({ error: error.message }, 400);
  if (data?.duplicate_event || data?.duplicate_lead || !data?.assigned_to) return json(data, 200);

  const notification = await sendStaffTemplate(data);
  await db.from('campaign_lead_inbox').update({
    notification_status: notification.sent ? 'sent' : notification.skipped ? 'skipped' : 'failed',
    notification_error: notification.error || null,
  }).eq('id', data.inbox_id);
  return json({ ...data, staff_notification: { sent: notification.sent, skipped: notification.skipped || false,
    error: notification.error || null } }, 201);
});


