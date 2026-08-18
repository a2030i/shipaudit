// hatif-tag-sync — نظام تاقات هاتف المؤتمت الكامل.
// 2026-07-31: تاقات لمحة مؤتمتة، أما تاقات الموظفين والإحالات اليدوية فتُحفَظ
// عند كل استبدال كامل تفرضه API هاتف ولا تُحذف تعريفاتها.
// v8: **إصلاح تجمّد العدّاد** — قراءة appliedMap كانت بلا تصفّح فتُقَص عند 1000 صف
// (فخّ §1.34)، فـ~121 صفاً مطبَّقاً يختفي ويُعاد معالجته كل تشغيلة ويلتهم الميزانية
// فلا تُطبَّق الأرقام الجديدة أبداً. الآن تصفّح كامل لـappliedMap (order phone + range).
// v7 كان يستبدل كل التاقات ويحذف اليدوية. عُكس هذا القرار لدعم إحالات الموظفين.
// (٢) يعتمد على ORDER BY الثابت في RPC hatif_phone_tags (إصلاح فخّ §1.34/§6 —
// بلا ترتيب ثابت كان تصفّح .range() يُسقط ~1506 صفاً فلا تُطبَّق أبداً).
// v2: أسماء مطابقة لهاتف + تصفّح كامل + حذف STRAY. لا يحذف تعريف تاق قانوني أبداً.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { runExternalEffect, sha256Hex } from '../_shared/idempotency.ts';

const CORS = { 'Access-Control-Allow-Origin': 'https://shipaudit-five.vercel.app', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const svc = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const env = (...n: string[]) => { for (const k of n) { const v = Deno.env.get(k); if (v && v.trim()) return v.trim(); } return ''; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// أسماء التاقات = تاقات المستخدم في هاتف بالضبط (لا تكرار) + إيموجي (icon حسب التوثيق)
const CANON: { name: string; icon: string }[] = [
  { name: 'عليه مديونية', icon: '🔴' }, { name: 'متأخر سداد', icon: '⏰' }, { name: 'رصيد سالب', icon: '🔻' },
  { name: 'VIP', icon: '⭐' }, { name: 'نشط', icon: '🟢' }, { name: 'متوقف', icon: '⛔' }, { name: 'جديد', icon: '🆕' },
  { name: 'دفع مسبق', icon: '💳' }, { name: 'دفع لاحق', icon: '📅' }, { name: 'عميل محتمل', icon: '🎯' }, { name: 'بلاك لست', icon: '🚫' },
];
const norm = (v: string) => String(v || '').trim();
const V = 'https://api.voxa.sa';
const SYSTEM_TAG_NAMES = new Set(CANON.map(t => norm(t.name)));

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
async function createTag(db: ReturnType<typeof svc>, token: string, name: string, icon: string): Promise<string | null> {
  const payload = { name, icon, isPinned: true };
  const effect = await runExternalEffect({
    db, flow: 'hatif-tag-definition', idempotencyKey: `hatif:tag:create:${await sha256Hex(norm(name))}`,
    payload,
    dispatch: () => fetch(`${V}/v1/tags/service-account`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) }),
  });
  const result = effect.body || {};
  return effect.ok && (result.id || result.tagId) ? String(result.id || result.tagId) : null;
}
// تفعيل التاق (المفتاح في واجهة هاتف = isPinned) — الموجود سابقاً بقي مُطفأً
async function enableTag(db: ReturnType<typeof svc>, token: string, id: string, name: string, icon: string): Promise<boolean> {
  const payload = { name, icon, isPinned: true };
  const effect = await runExternalEffect({
    db, flow: 'hatif-tag-definition', idempotencyKey: `hatif:tag:update:${id}:${await sha256Hex(payload)}`,
    payload,
    dispatch: () => fetch(`${V}/v1/tags/service-account/${id}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) }),
  });
  return effect.ok;
}

async function mergeWithHumanTags(token: string, conversationId: string, systemIds: string[]) {
  const r = await fetch(`${V}/v2/conversations/service-account/${conversationId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`conversation read http ${r.status}`);
  const j = await r.json().catch(() => ({}));
  const current = Array.isArray(j.tags) ? j.tags : [];
  const humanIds: string[] = [];
  for (const t of current) {
    const id = t?.id || t?.tagId;
    const name = norm(t?.name || t?.title || '');
    if (id && (!name || !SYSTEM_TAG_NAMES.has(name))) humanIds.push(String(id));
  }
  return { ids: [...new Set([...humanIds, ...systemIds])], preserved: humanIds.length };
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
  for (const t of CANON) { if (!tagMap.has(norm(t.name))) { try { const id = await createTag(db, token, t.name, t.icon); if (id) created++; await sleep(200); } catch { /* */ } } }
  if (created) tagMap = await listTags(token);
  // تفعيل كل تاق قانوني (isPinned) — التاقات المُنشأة سابقاً بقيت مُطفأة في واجهة هاتف
  let enabled = 0;
  for (const t of CANON) {
    const id = tagMap.get(norm(t.name));
    if (id) { try { if (await enableTag(db, token, id, t.name, t.icon)) enabled++; await sleep(150); } catch { /* */ } }
  }

  // 2) الحالة المرغوبة — تصفّح كامل (تجاوز حدّ 1000)
  const desired: { phone: string; tags: string[] }[] = [];
  for (let off = 0; off < 20000; off += 1000) {
    const { data } = await db.rpc('hatif_phone_tags').range(off, off + 999);
    const rows = (data || []) as { phone: string; tags: string[] }[];
    desired.push(...rows);
    if (rows.length < 1000) break;
  }
  // تصفّح كامل — الجدول >1000 صف وPostgREST يقفه عند 1000 (فخّ §1.34): بلا تصفّح
  // تختفي ~121 صفاً مطبَّقاً من appliedMap فتُعاد معالجتها كل تشغيلة وتلتهم الميزانية
  // فلا تصل الأرقام الجديدة أبداً (العدّاد يتجمّد). ORDER BY phone ثابت للتصفّح.
  const appliedMap = new Map<string, string[]>();
  for (let off = 0; off < 100000; off += 1000) {
    const { data } = await db.from('hatif_conversation_tags').select('phone, tag_names').order('phone', { ascending: true }).range(off, off + 999);
    const rows = (data || []) as { phone: string; tag_names: string[] }[];
    for (const r of rows) appliedMap.set(r.phone, r.tag_names || []);
    if (rows.length < 1000) break;
  }

  // 3) المتغيّرات فقط
  const eqSet = (x: string[], y: string[]) => x.length === y.length && [...x].sort().join('|') === [...y].sort().join('|');
  const changed = desired.filter(r => !eqSet(r.tags || [], appliedMap.get(r.phone) || []))
    .filter(r => (r.tags || []).length > 0 || appliedMap.has(r.phone));

  const t0 = Date.now(); let applied_n = 0, failed = 0, skipped = 0, preserved = 0;
  for (const r of changed) {
    if (applied_n + failed >= LIMIT || Date.now() - t0 > 125000) break;
    const { data: s } = await db.from('whatsapp_campaign_sends').select('conversation_id').eq('phone', r.phone).not('conversation_id', 'is', null).order('sent_at', { ascending: false }).limit(1);
    const convId = s?.[0]?.conversation_id;
    if (!convId) { skipped++; continue; }

    const names = r.tags || [];
    const wantIds = names.map(n => tagMap.get(norm(n))).filter(Boolean) as string[];
    // تعيين ناقص (إنشاء فشل) — لا نُطبّق كي لا نمسح
    if (names.length > 0 && wantIds.length < names.length) { skipped++; continue; }
    try {
      // API هاتف تستبدل القائمة كاملة؛ اقرأ الحالية واحفظ كل ما لا تملكه لمحة.
      const merged = await mergeWithHumanTags(token, convId, wantIds);
      const tagPayload = { tagIds: [...merged.ids].sort() };
      const rr = await runExternalEffect({
        db, flow: 'hatif-conversation-tags', idempotencyKey: `hatif:conversation-tags:${convId}:${await sha256Hex(tagPayload)}`,
        payload: tagPayload,
        dispatch: () => fetch(`${V}/v2/conversations/service-account/${convId}/tags`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(tagPayload) }),
      });
      if (rr.ok) {
        await db.from('hatif_conversation_tags').upsert({ phone: r.phone, conversation_id: convId, tag_names: names, applied_at: new Date().toISOString() }, { onConflict: 'phone' });
        applied_n++; preserved += merged.preserved;
      } else failed++;
    } catch { failed++; }
    await sleep(200);
  }
  return json({ ok: true, changed: changed.length, applied: applied_n, failed, skipped, created, deleted: 0, enabled, preserved, remaining: Math.max(0, changed.length - applied_n - failed - skipped) });
});
