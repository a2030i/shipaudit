// hatif-lead-names v1 (2026-07-23) — أسماء «العملاء خارج المنصّة» (crm_leads) إلى جهات هاتف.
// جهاتهم أُنشئت وقت الحملة باسم = الرقم؛ سنك المتاجر (hatif-contacts-sync) لا يشملهم.
// يكتب الاسم فقط إن كان الاسم الحالي في هاتف رقماً (لا يدهس اسم الفريق). المصدر RPC hatif_lead_names().
// التاق «عميل محتمل» يتكفّل به hatif-tag-sync. دالة مستقلّة صغيرة لا تلمس سنك المتاجر.
// ⚠️ النشر عبر MCP يعيد verify_jwt=true — استدعاء الكرون يحتاج Bearer anon + X-Cron-Key.
import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_ORIGIN = 'https://shipaudit-five.vercel.app';
const CORS = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const svc = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const env = (...n: string[]) => { for (const x of n) { const v = Deno.env.get(x); if (v && v.trim()) return v.trim(); } return ''; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const V = 'https://api.voxa.sa';
const CONTACTS_URL = `${V}/v1/contacts`;
const dg = (v: unknown) => String(v || '').replace(/\D/g, '');
const unwrap = (j: any) => (j && typeof j === 'object' && 'id' in j && typeof j.id === 'object') ? j.id : j;
function hash(s: string) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h >>> 0); }

async function accessToken() {
  const id = env('client_id', 'HATIF_CLIENT_ID'), secret = env('secret', 'HATIF_CLIENT_SECRET');
  if (!id || !secret) throw new Error('no hatif secrets');
  const r = await fetch(`${V}/connect/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret, scope: 'VoxaAPI' }) });
  const j = await r.json(); if (!j.access_token) throw new Error('token failed'); return j.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const db = svc();
  let body: Record<string, any> = {}; try { body = await req.json(); } catch { /* */ }
  const all = body.all === true;
  const maxWrites = Math.min(Math.max(Number(body.maxWrites) || 60, 1), 200);
  const limit = Math.min(Math.max(Number(body.limit) || 60, 1), 1000);
  const offset = Math.max(Number(body.offset) || 0, 0);

  // مصادقة: مفتاح الكرون أو مدير/crm.view/sales.hatif_leads (نفس سنك المتاجر)
  let authed = false;
  const ck = req.headers.get('X-Cron-Key') || req.headers.get('x-cron-key');
  if (ck) { const { data: za } = await db.from('zoho_auth').select('cron_key').eq('id', 1).maybeSingle(); if (za?.cron_key && za.cron_key === ck) authed = true; }
  if (!authed) {
    const uc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
    const { data: { user } } = await uc.auth.getUser();
    if (user) {
      const { data: p } = await db.from('profiles').select('role, permissions').eq('id', user.id).maybeSingle();
      authed = p?.role === 'admin' || p?.permissions?.['crm.view'] === true || p?.permissions?.['sales.hatif_leads'] === true;
    }
  }
  if (!authed) return json({ error: 'unauthorized' }, 401);

  let token: string; try { token = await accessToken(); } catch (e) { return json({ ok: false, error: String((e as Error).message || e) }); }

  // تحميل الـleads (صفحات في وضع all — تجاوز حدّ 1000، §1.34)
  const leads: any[] = [];
  if (all) {
    for (let off = 0; off < 40000; off += 1000) {
      const { data, error } = await db.rpc('hatif_lead_names').order('phone', { ascending: true }).range(off, off + 999);
      if (error) return json({ ok: false, error: `leads: ${error.message}` });
      const c = data || []; leads.push(...c);
      if (c.length < 1000) break;
    }
  } else {
    const { data, error } = await db.rpc('hatif_lead_names').order('phone', { ascending: true }).range(offset, offset + limit - 1);
    if (error) return json({ ok: false, error: `leads: ${error.message}` });
    leads.push(...(data || []));
  }

  const { data: prev } = await db.from('hatif_contact_sync').select('phone, contact_id, payload_hash').in('phone', leads.map((r: any) => r.phone));
  const prevMap = new Map((prev || []).map((p: any) => [p.phone, p]));

  let named = 0, created = 0, kept = 0, skipped = 0, failed = 0, writes = 0, remaining = 0;
  const errors: unknown[] = [];
  for (const r of leads) {
    const h = hash('lead:' + r.name);
    const st: any = prevMap.get(r.phone);
    if (st?.payload_hash === h && st?.contact_id) { skipped++; continue; }
    if (writes >= maxWrites) { remaining++; continue; }
    writes++;
    try {
      const sr = await fetch(`${CONTACTS_URL}?SkipCount=0&MaxResultCount=10&phoneNumber=${encodeURIComponent(r.phone)}`, { headers: { Authorization: `Bearer ${token}` } });
      const items: any[] = unwrap(await sr.json().catch(() => ({})))?.items || [];
      const hit = items.find((c: any) => dg(c.phoneNumber) === dg(r.phone)) || null;
      let cid: string | null = hit?.id || null;
      const cur = String(hit?.name || '').trim();
      const hasName = !!cur && /\p{L}/u.test(cur);   // اسم حقيقي = يحوي حرفاً
      await sleep(90);
      if (!cid) {
        const cr = await fetch(CONTACTS_URL, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ name: r.name, phoneNumber: r.phone }) });
        if (!cr.ok) { failed++; if (errors.length < 5) errors.push({ phone: r.phone, step: 'create', status: cr.status }); await sleep(90); continue; }
        cid = unwrap(await cr.json().catch(() => ({})))?.id || null;
        created++; await sleep(90);
      } else if (!hasName) {
        const pr = await fetch(`${CONTACTS_URL}/${cid}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ name: r.name }) });
        if (pr.ok) named++; else { failed++; if (errors.length < 5) errors.push({ phone: r.phone, step: 'rename', status: pr.status }); }
        await sleep(90);
      } else {
        kept++;   // اسم حقيقي (فريق) — لا نلمسه
      }
      if (cid) await db.from('hatif_contact_sync').upsert({ phone: r.phone, contact_id: cid, payload_hash: h, synced_at: new Date().toISOString(), error: null }, { onConflict: 'phone' });
    } catch (e) { failed++; if (errors.length < 5) errors.push({ phone: r.phone, error: String((e as Error).message || e) }); }
  }
  return json({ ok: true, leads: leads.length, named, created, kept, skipped, failed, remaining,
    nextOffset: (!all && leads.length === limit) ? offset + limit : null, errors: errors.slice(0, 5) });
});
