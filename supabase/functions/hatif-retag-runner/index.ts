// hatif-retag-runner v1 (2026-07-23) — المستهلك الخفيف لقائمة إعادة الوسم الحدثية.
// المنتِجون: تريجرات (زوهو/بلاك لست/محادثة جديدة) يضعون الأرقام المتأثّرة في
// hatif_retag_dirty. هذا المشغّل (cron كل 5د) يطبّق المتأثّرين فقط على هاتف بسرعة —
// يفصل حجم الأحداث عن نداءات Voxa (لا يتصل بهاتف إلا لمن تغيّر تاقه فعلاً).
// الكرون الكامل (hatif-tag-sync، 20د) يبقى شبكة أمان للتاقات الزمنية.
// ⚠️ النشر عبر MCP يعيد verify_jwt=true — الكرون يحتاج X-Cron-Key.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': 'https://shipaudit-five.vercel.app', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const svc = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const env = (...n: string[]) => { for (const k of n) { const v = Deno.env.get(k); if (v && v.trim()) return v.trim(); } return ''; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
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
  const r = await fetch(`${V}/v1/tags/service-account?maxResultCount=500&skipCount=0`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  const items = Array.isArray(j) ? j : (j.items || j.tags || []);
  const m = new Map<string, string>();
  for (const t of items) { const id = t.id || t.tagId; const nm = t.name || t.title; if (id && nm) m.set(norm(nm), String(id)); }
  return m;
}

async function requireAuth(req: Request, db: ReturnType<typeof svc>) {
  const { data: za } = await db.from('zoho_auth').select('cron_key').eq('id', 1).maybeSingle();
  const ck = req.headers.get('X-Cron-Key') || req.headers.get('x-cron-key') || '';
  if (za?.cron_key && ck === za.cron_key) return true;
  const uc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
  const { data: { user } } = await uc.auth.getUser();
  if (!user) return false;
  const { data: p } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle();
  return p?.role === 'admin';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const db = svc();
  if (!(await requireAuth(req, db))) return json({ error: 'forbidden' }, 403);
  let body: Record<string, any> = {}; try { body = await req.json(); } catch { /* */ }
  const maxWrites = Math.min(120, Number(body.maxWrites) || 80);

  // قائمة المتّسخين — إن فرغت نخرج بلا لمس هاتف (تشغيلة شبه مجانية)
  const { data: dirtyRows } = await db.from('hatif_retag_dirty').select('phone').order('queued_at', { ascending: true }).limit(300);
  const dirty = (dirtyRows || []).map((r: any) => r.phone);
  if (!dirty.length) return json({ ok: true, dirty: 0 });

  let token = ''; try { token = await accessToken(); } catch (e) { return json({ ok: false, error: String((e as Error).message || e) }); }
  const tagMap = await listTags(token);

  // الحالة المرغوبة (كل الأرقام — استعلام DB رخيص) ثم فلترة للمتّسخين
  const desiredMap = new Map<string, string[]>();
  for (let off = 0; off < 20000; off += 1000) {
    const { data } = await db.rpc('hatif_phone_tags').range(off, off + 999);
    const rows = (data || []) as { phone: string; tags: string[] }[];
    for (const r of rows) desiredMap.set(r.phone, r.tags || []);
    if (rows.length < 1000) break;
  }
  const { data: appliedRows } = await db.from('hatif_conversation_tags').select('phone, tag_names').in('phone', dirty);
  const appliedMap = new Map<string, string[]>();
  for (const r of (appliedRows || []) as { phone: string; tag_names: string[] }[]) appliedMap.set(r.phone, r.tag_names || []);

  const eqSet = (x: string[], y: string[]) => x.length === y.length && [...x].sort().join('|') === [...y].sort().join('|');
  const t0 = Date.now();
  let applied = 0, unchanged = 0, noconv = 0, failed = 0;
  const done: string[] = [];   // أرقام عولجت (تُحذف من القائمة)

  for (const phone of dirty) {
    if (applied + failed >= maxWrites || Date.now() - t0 > 125000) break;
    const desired = desiredMap.get(phone) || [];               // غير موجود = بلا محادثة/تاق
    const cur = appliedMap.get(phone) || [];
    if (eqSet(desired, cur)) { unchanged++; done.push(phone); continue; }

    const { data: s } = await db.from('whatsapp_campaign_sends').select('conversation_id').eq('phone', phone).not('conversation_id', 'is', null).order('sent_at', { ascending: false }).limit(1);
    const convId = s?.[0]?.conversation_id;
    if (!convId) { noconv++; done.push(phone); continue; }        // لا محادثة → لا شيء نطبّقه، نُخرجه من القائمة

    const wantIds = desired.map(n => tagMap.get(norm(n))).filter(Boolean) as string[];
    if (desired.length > 0 && wantIds.length < desired.length) { failed++; continue; }   // تعيين ناقص → أبقِه للمرّة القادمة
    try {
      const rr = await fetch(`${V}/v2/conversations/service-account/${convId}/tags`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ tagIds: wantIds }) });
      if (rr.ok) {
        await db.from('hatif_conversation_tags').upsert({ phone, conversation_id: convId, tag_names: desired, applied_at: new Date().toISOString() }, { onConflict: 'phone' });
        applied++; done.push(phone);
      } else { failed++; }
    } catch { failed++; }
    await sleep(200);
  }

  if (done.length) await db.from('hatif_retag_dirty').delete().in('phone', done);
  return json({ ok: true, dirty: dirty.length, applied, unchanged, noconv, failed, remaining: Math.max(0, dirty.length - done.length) });
});
