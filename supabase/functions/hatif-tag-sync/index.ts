// hatif-tag-sync v2 (2026-07-23) — نظام تاقات هاتف المؤتمت الكامل.
// v2: (١) أسماء التاقات مطابقة لتاقات المستخدم في هاتف («عليه مديونية»). (٢) تصفّح
// RPC كامل (تجاوز حدّ 1000 صف §1.34). (٣) **يحافظ على التاقات اليدوية** (اجتماع…):
// يقرأ تاقات المحادثة الحالية، يُبقي غير-القانونية، ويدمجها مع تاقاتنا (POST يستبدل).
// (٤) لا يُطبّق إن نقص تعيين تاق (كي لا يمسح). لا يحذف تعريف تاق أبداً.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': 'https://shipaudit-five.vercel.app', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const svc = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const env = (...n: string[]) => { for (const k of n) { const v = Deno.env.get(k); if (v && v.trim()) return v.trim(); } return ''; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// أسماء التاقات = تاقات المستخدم في هاتف بالضبط (لا تكرار) + إيموجي (icon حسب التوثيق)
const CANON: { name: string; icon: string }[] = [
  { name: 'عليه مديونية', icon: '🔴' }, { name: 'VIP', icon: '⭐' }, { name: 'متوقف', icon: '⛔' },
  { name: 'دفع مسبق', icon: '💳' }, { name: 'عميل محتمل', icon: '🎯' }, { name: 'ردّ بشري', icon: '💬' },
];
const STRAY = ['مديونية'];   // تاقات خاطئة من نسخ سابقة — تُحذف إن وُجد البديل القانوني
const norm = (v: string) => String(v || '').trim();
const V = 'https://api.voxa.sa';

async function accessToken() {
  const id = env('client_id', 'HATIF_CLIENT_ID'), secret = env('secret', 'HATIF_CLIENT_SECRET');
  if (!id || !secret) throw new Error('no hatif secrets');
  const r = await fetch(`${V}/connect/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret, scope: 'VoxaAPI' }) });
  const j = await r.json(); if (!j.access_token) throw new Error('token failed'); return j.access_token as string;
}
async function listTags(token: string): Promise<Map<string, string>> {
  // الافتراضي 10 فقط — نطلب صفحة كبيرة لجلب كل التاقات
  const r = await fetch(`${V}/v1/tags/service-account?maxResultCount=500&skipCount=0`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  const items = Array.isArray(j) ? j : (j.items || j.tags || []);
  const m = new Map<string, string>();
  for (const t of items) { const id = t.id || t.tagId; const nm = t.name || t.title; if (id && nm) m.set(norm(nm), String(id)); }
  return m;
}
async function createTag(token: string, name: string, icon: string): Promise<string | null> {
  const r = await fetch(`${V}/v1/tags/service-account`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name, icon, isPinned: true }) });
  const j = await r.json().catch(() => ({}));
  return (j.id || j.tagId) ? String(j.id || j.tagId) : null;
}
async function deleteTag(token: string, id: string): Promise<boolean> {
  const r = await fetch(`${V}/v1/tags/service-account/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  return r.ok || r.status === 204;
}
// تاقات المحادثة الحالية (لنُبقي اليدوية عند الاستبدال)
async function currentConvTagIds(token: string, convId: string): Promise<string[] | null> {
  try {
    const r = await fetch(`${V}/v2/conversations/service-account/${convId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const j = await r.json().catch(() => ({}));
    const raw = j.tags || j.conversationTags || j.tagIds || [];
    return (Array.isArray(raw) ? raw : []).map((t: any) => String(t?.id || t?.tagId || t)).filter(Boolean);
  } catch { return null; }
}

async function requireAuth(req: Request, db: ReturnType<typeof svc>) {
  const { data: za } = await db.from('zoho_auth').select('cron_key').eq('id', 1).maybeSingle();
  const ck = req.headers.get('X-Cron-Key') || '';
  if (za?.cron_key && ck === za.cron_key) return { ok: true };
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
  const LIMIT = Math.min(120, Number(body.limit) || 60);

  let token = ''; try { token = await accessToken(); } catch (e) { return json({ ok: false, error: String((e as Error).message || e) }); }

  // وضع «سرد فقط» — يُرجِع كل تاقات هاتف بلا أي تعديل (للاطّلاع/التشخيص)
  if (body.list === true) {
    const m = await listTags(token);
    return json({ ok: true, count: m.size, tags: [...m.entries()].map(([name, id]) => ({ name, id })) });
  }

  // 1) خريطة الاسم→id + إنشاء الناقص، ثم إعادة السرد لضمان الـIDs
  let tagMap = await listTags(token);
  let created = 0;
  for (const t of CANON) { if (!tagMap.has(norm(t.name))) { try { const id = await createTag(token, t.name, t.icon); if (id) created++; await sleep(200); } catch { /* */ } } }
  if (created) tagMap = await listTags(token);
  // حذف التاقات الخاطئة المكرّرة (مثل «مديونية») إن وُجد البديل القانوني («عليه مديونية»)
  let deleted = 0;
  for (const bad of STRAY) {
    const badId = tagMap.get(norm(bad));
    if (badId && tagMap.has(norm('عليه مديونية'))) { try { if (await deleteTag(token, badId)) { tagMap.delete(norm(bad)); deleted++; } await sleep(200); } catch { /* */ } }
  }
  const canonIds = new Set(CANON.map(t => tagMap.get(norm(t.name))).filter(Boolean) as string[]);

  // 2) الحالة المرغوبة — تصفّح كامل (تجاوز حدّ 1000)
  const desired: { phone: string; tags: string[] }[] = [];
  for (let off = 0; off < 20000; off += 1000) {
    const { data } = await db.rpc('hatif_phone_tags').range(off, off + 999);
    const rows = (data || []) as { phone: string; tags: string[] }[];
    desired.push(...rows);
    if (rows.length < 1000) break;
  }
  const { data: applied } = await db.from('hatif_conversation_tags').select('phone, tag_names');
  const appliedMap = new Map<string, string[]>();
  for (const r of (applied || []) as { phone: string; tag_names: string[] }[]) appliedMap.set(r.phone, r.tag_names || []);

  // 3) المتغيّرات فقط
  const eqSet = (x: string[], y: string[]) => x.length === y.length && [...x].sort().join('|') === [...y].sort().join('|');
  const changed = desired.filter(r => !eqSet(r.tags || [], appliedMap.get(r.phone) || []))
    .filter(r => (r.tags || []).length > 0 || appliedMap.has(r.phone));

  const t0 = Date.now(); let applied_n = 0, failed = 0, skipped = 0;
  for (const r of changed) {
    if (applied_n + failed >= LIMIT || Date.now() - t0 > 125000) break;
    const { data: s } = await db.from('whatsapp_campaign_sends').select('conversation_id').eq('phone', r.phone).not('conversation_id', 'is', null).order('sent_at', { ascending: false }).limit(1);
    const convId = s?.[0]?.conversation_id;
    if (!convId) { skipped++; continue; }

    const names = r.tags || [];
    const wantIds = names.map(n => tagMap.get(norm(n))).filter(Boolean) as string[];
    // تعيين ناقص (إنشاء فشل) — لا نُطبّق كي لا نمسح
    if (names.length > 0 && wantIds.length < names.length) { skipped++; continue; }
    // اقرأ التاقات الحالية وأبقِ اليدوية (غير القانونية) — GET يفشل ⇒ لا نمسّ
    const cur = await currentConvTagIds(token, convId);
    if (cur === null) { skipped++; continue; }
    const preserved = cur.filter(id => !canonIds.has(id));
    const finalIds = [...new Set([...preserved, ...wantIds])];

    try {
      const rr = await fetch(`${V}/v2/conversations/service-account/${convId}/tags`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ tagIds: finalIds }) });
      if (rr.ok) {
        await db.from('hatif_conversation_tags').upsert({ phone: r.phone, conversation_id: convId, tag_names: names, applied_at: new Date().toISOString() }, { onConflict: 'phone' });
        applied_n++;
      } else failed++;
    } catch { failed++; }
    await sleep(250);
  }
  return json({ ok: true, changed: changed.length, applied: applied_n, failed, skipped, created, deleted, remaining: Math.max(0, changed.length - applied_n - failed - skipped) });
});
