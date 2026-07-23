// hatif-tag-sync v1 (2026-07-23) — نظام تاقات هاتف المؤتمت الكامل.
// يحسب تاقات كل رقم له محادثة من بياناتنا (RPC hatif_phone_tags): مديونية/VIP/متوقف/
// دفع مسبق/عميل محتمل/ردّ بشري (رقم بعدة متاجر = الأعلى شحناً). يُنشئ التاقات الناقصة
// في هاتف تلقائياً، ثم يطبّق المتغيّر فقط (diff عبر hatif_conversation_tags) بدفعات
// محترمة للحصّة. cron (X-Cron-Key) أو admin يدوياً. POST tags يستبدل القائمة (idempotent).
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': 'https://shipaudit-five.vercel.app', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const svc = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const env = (...n: string[]) => { for (const k of n) { const v = Deno.env.get(k); if (v && v.trim()) return v.trim(); } return ''; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// كتالوج التاقات القانونية + ألوانها — تُنشأ في هاتف إن غابت
const CANON: { name: string; color: string }[] = [
  { name: 'مديونية', color: '#DC2626' }, { name: 'VIP', color: '#F59E0B' }, { name: 'متوقف', color: '#6B7280' },
  { name: 'دفع مسبق', color: '#8B5CF6' }, { name: 'عميل محتمل', color: '#3B82F6' }, { name: 'ردّ بشري', color: '#16A34A' },
];
const norm = (v: string) => String(v || '').trim();

async function accessToken() {
  const id = env('client_id', 'HATIF_CLIENT_ID'), secret = env('secret', 'HATIF_CLIENT_SECRET');
  if (!id || !secret) throw new Error('no hatif secrets');
  const r = await fetch('https://api.voxa.sa/connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret, scope: 'VoxaAPI' }) });
  const j = await r.json(); if (!j.access_token) throw new Error('token failed'); return j.access_token as string;
}
async function listTags(token: string): Promise<Map<string, string>> {
  const r = await fetch('https://api.voxa.sa/v1/tags/service-account', { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  const items = Array.isArray(j) ? j : (j.items || j.tags || []);
  const m = new Map<string, string>();
  for (const t of items) { const id = t.id || t.tagId; const nm = t.name || t.title; if (id && nm) m.set(norm(nm), String(id)); }
  return m;
}
async function createTag(token: string, name: string, color: string): Promise<string | null> {
  const r = await fetch('https://api.voxa.sa/v1/tags/service-account', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name, color }) });
  const j = await r.json().catch(() => ({}));
  return (j.id || j.tagId) ? String(j.id || j.tagId) : null;
}

async function requireAuth(req: Request, db: ReturnType<typeof svc>) {
  const { data: za } = await db.from('zoho_auth').select('cron_key').eq('id', 1).maybeSingle();
  const ck = req.headers.get('X-Cron-Key') || '';
  if (za?.cron_key && ck === za.cron_key) return { ok: true, cron: true };
  const authHeader = req.headers.get('Authorization') || '';
  const uc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await uc.auth.getUser();
  if (!user) return { ok: false };
  const { data: p } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle();
  return { ok: p?.role === 'admin' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const db = svc();
  const a = await requireAuth(req, db);
  if (!a.ok) return json({ error: 'forbidden' }, 403);
  let body: Record<string, any> = {}; try { body = await req.json(); } catch { /* */ }
  const LIMIT = Math.min(120, Number(body.limit) || 80);   // دفعة لكل تشغيلة (حصة Voxa)

  let token = ''; try { token = await accessToken(); } catch (e) { return json({ ok: false, error: String((e as Error).message || e) }); }

  // 1) خريطة الاسم→id، وإنشاء الناقص
  const tagMap = await listTags(token);
  for (const t of CANON) {
    if (!tagMap.has(norm(t.name))) { try { const id = await createTag(token, t.name, t.color); if (id) tagMap.set(norm(t.name), id); await sleep(200); } catch { /* */ } }
  }

  // 2) الحالة المرغوبة لكل رقم + آخر ما طُبِّق
  const { data: desired } = await db.rpc('hatif_phone_tags');
  const { data: applied } = await db.from('hatif_conversation_tags').select('phone, tag_names');
  const appliedMap = new Map<string, string[]>();
  for (const r of (applied || []) as { phone: string; tag_names: string[] }[]) appliedMap.set(r.phone, r.tag_names || []);

  // 3) اجمع المتغيّرات فقط (diff)
  const eqSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
  const changed = ((desired || []) as { phone: string; tags: string[] }[])
    .filter(r => !eqSet(r.tags || [], appliedMap.get(r.phone) || []))
    .filter(r => (r.tags || []).length > 0 || appliedMap.has(r.phone));   // تجاهل بلا-تاق ولم يُطبَّق قط

  const t0 = Date.now(); let applied_n = 0, failed = 0, skipped = 0;
  for (const r of changed) {
    if (applied_n + failed >= LIMIT || Date.now() - t0 > 120000) break;
    // أحدث محادثة للرقم
    const { data: s } = await db.from('whatsapp_campaign_sends').select('conversation_id').eq('phone', r.phone).not('conversation_id', 'is', null).order('sent_at', { ascending: false }).limit(1);
    const convId = s?.[0]?.conversation_id;
    if (!convId) { skipped++; continue; }
    const tagIds = (r.tags || []).map(n => tagMap.get(norm(n))).filter(Boolean) as string[];
    try {
      const rr = await fetch(`https://api.voxa.sa/v2/conversations/service-account/${convId}/tags`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ tagIds }) });
      if (rr.ok) {
        await db.from('hatif_conversation_tags').upsert({ phone: r.phone, conversation_id: convId, tag_names: r.tags || [], applied_at: new Date().toISOString() }, { onConflict: 'phone' });
        applied_n++;
      } else failed++;
    } catch { failed++; }
    await sleep(300);
  }
  return json({ ok: true, changed: changed.length, applied: applied_n, failed, skipped, remaining: Math.max(0, changed.length - applied_n - failed - skipped) });
});
