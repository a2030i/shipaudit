// hatif-tags v2 (2026-07-23) — وسم محادثات هاتف/Voxa يدوياً بحالة العميل.
// v2: List Tags بـmaxResultCount=500 (الافتراضي 10 فقط). الرد {totalCount, items:[{id,name,...}]}.
// action list  → GET /v1/tags/service-account (التاقات المتاحة).
// action apply → POST /v2/conversations/service-account/{convId}/tags {tagIds}
//   يجد أحدث conversation_id للعميل من whatsapp_campaign_sends بالهاتف ثم يطبّق.
//   tagIds فارغة = إزالة كل التاقات (بعد إنهاء الفريق). الحارس: campaigns.send.
import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_ORIGIN = 'https://shipaudit-five.vercel.app';
const CORS = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const svc = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
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
let tokenCache: { token: string; exp: number } | null = null;
async function accessToken() {
  if (tokenCache && tokenCache.exp > Date.now()) return tokenCache.token;
  const id = env('client_id', 'HATIF_CLIENT_ID'), secret = env('secret', 'HATIF_CLIENT_SECRET');
  if (!id || !secret) throw new Error('no hatif secrets');
  const r = await fetch('https://api.voxa.sa/connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret, scope: 'VoxaAPI' }) });
  const j = await r.json(); if (!j.access_token) throw new Error('token failed');
  tokenCache = { token: j.access_token, exp: Date.now() + ((Number(j.expires_in) || 3600) * 1000) - 60000 };
  return tokenCache.token;
}
async function requireUser(req: Request, db: ReturnType<typeof svc>) {
  const authHeader = req.headers.get('Authorization') || '';
  const uc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await uc.auth.getUser();
  if (!user) return null;
  const { data: p } = await db.from('profiles').select('role, permissions').eq('id', user.id).maybeSingle();
  return { id: user.id, role: p?.role || null, permissions: p?.permissions || {} };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const db = svc();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* */ }
  const action = String(body.action || 'list');

  const auth = await requireUser(req, db);
  if (!auth) return json({ error: 'unauthorized — سجّل دخولك' }, 401);
  const allowed = auth.role === 'admin' || auth.permissions?.['campaigns.send'] === true;
  if (!allowed) return json({ error: 'forbidden — تحتاج صلاحية «إطلاق حملة واتساب»' }, 403);

  let token: string;
  try { token = await accessToken(); } catch (e) { return json({ ok: false, error: String((e as Error).message || e) }); }

  if (action === 'list') {
    try {
      const r = await fetch('https://api.voxa.sa/v1/tags/service-account?maxResultCount=500&skipCount=0', { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json().catch(() => ({}));
      const items = Array.isArray(j) ? j : (j.items || j.tags || []);
      return json({ ok: true, tags: items.map((t: Record<string, any>) => ({ id: t.id || t.tagId, name: t.name || t.title, color: t.color || t.colour || null })) });
    } catch (e) { return json({ ok: false, error: String((e as Error).message || e) }); }
  }

  if (action === 'apply') {
    const phone = norm(body.phone);
    const tagIds = Array.isArray(body.tagIds) ? body.tagIds.map(String) : [];
    if (!phone) return json({ ok: false, error: 'لا رقم' });
    // أحدث محادثة لهذا العميل
    const { data: sends } = await db.from('whatsapp_campaign_sends').select('conversation_id')
      .eq('phone', phone).not('conversation_id', 'is', null).order('sent_at', { ascending: false }).limit(1);
    const convId = sends?.[0]?.conversation_id;
    if (!convId) return json({ ok: false, error: 'لا محادثة واتساب لهذا العميل في هاتف — أرسل له حملة أولاً' });
    try {
      const r = await fetch(`https://api.voxa.sa/v2/conversations/service-account/${convId}/tags`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ tagIds }),
      });
      if (r.ok) return json({ ok: true, conversation_id: convId, applied: tagIds.length });
      const j = await r.json().catch(() => ({}));
      return json({ ok: false, error: j.message || j.title || `http ${r.status}` });
    } catch (e) { return json({ ok: false, error: String((e as Error).message || e) }); }
  }

  return json({ error: 'unknown action (list|apply)' }, 400);
});
