// hatif-contacts-sync — يدفع سياق العميل إلى جهات اتصال هاتف ليراه الموظفون:
//   note        = «المتاجر: أ · ب | شحنات | آخر شحنة | دين | محفظة»
//   customFields= الوسوم + الأرقام (دين/محفظة/متاجر/شحنات/آخر شحنة)
// المصدر: RPC hatif_contact_labels() — موحّد بالهاتف (عميل بعدة متاجر = جهة واحدة).
//
// ⚠️ هاتف لا يوفّر endpoint لربط Tag بجهة اتصال (Tags API = تعريف الوسم فقط)،
// لذا «الوسوم» تُكتب داخل customFields + note — وهي الآلية الوحيدة المدعومة.
//
// حصة Voxa (~100/دقيقة مشتركة): نخزّن contact_id + بصمة الحمولة في
// hatif_contact_sync فلا نستدعي هاتف إلا للمتغيّر (وبلا بحث بعد أول مرة).
// الدفعات: limit/offset مع ترتيب ثابت (phone) — offset التالي يعود في nextOffset.
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

const TOKEN_URL = 'https://api.voxa.sa/connect/token';
const CONTACTS_URL = 'https://api.voxa.sa/v1/contacts';

// بصمة بسيطة (djb2) لكشف تغيّر الحمولة
function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

let tokenCache: { token: string; exp: number } | null = null;
async function accessToken() {
  if (tokenCache && tokenCache.exp > Date.now()) return tokenCache.token;
  const id = env('client_id', 'HATIF_CLIENT_ID'), secret = env('secret', 'HATIF_CLIENT_SECRET');
  if (!id || !secret) throw new Error('أسرار Hatif غير مضبوطة');
  const r = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret, scope: 'VoxaAPI' }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('فشل توكن Hatif');
  tokenCache = { token: j.access_token, exp: Date.now() + ((Number(j.expires_in) || 3600) * 1000) - 60000 };
  return tokenCache.token;
}

// ردود هاتف ملفوفة تحت مفتاح id (نزوة موثّقة) — نفكّها بتسامح
const unwrap = (j: any) => (j && typeof j === 'object' && 'id' in j && typeof j.id === 'object') ? j.id : j;

async function findContactId(token: string, phone: string) {
  const u = `${CONTACTS_URL}?SkipCount=0&MaxResultCount=10&phoneNumber=${encodeURIComponent(phone)}`;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const body = unwrap(await r.json().catch(() => ({})));
  const items: any[] = body?.items || [];
  const digits = (v: unknown) => String(v || '').replace(/\D/g, '');
  const hit = items.find(c => digits(c.phoneNumber) === digits(phone));   // مطابقة تامة (الفلتر جزئي)
  return hit?.id || null;
}

function buildPayload(row: any) {
  const tags: string[] = Array.isArray(row.tags) ? row.tags : [];
  const num = (v: unknown) => String(Math.round(Number(v) || 0));
  const customFields: Record<string, string> = {
    'الوسوم': tags.join(' · ') || '—',
    'الدين': num(row.debt),
    'المحفظة': num(row.wallet),
    'المتاجر': String(row.store_count || 1),
    'الشحنات': num(row.shipments),
    'آخر شحنة': row.days_since_last == null ? 'لم يشحن' : `${row.days_since_last} يوم`,
  };
  return { name: row.name || row.phone, note: row.note || '', customFields };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const db = svc();
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* */ }
  const action = String(body.action || 'preview');
  const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 200);
  const offset = Math.max(Number(body.offset) || 0, 0);

  // هوية: cron أو مستخدم مخوَّل
  let authed = false;
  const cronKey = req.headers.get('X-Cron-Key') || req.headers.get('x-cron-key');
  if (cronKey) {
    const { data: za } = await db.from('zoho_auth').select('cron_key').eq('id', 1).maybeSingle();
    if (za?.cron_key && za.cron_key === cronKey) authed = true;
  }
  if (!authed) {
    const uc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
    const { data: { user } } = await uc.auth.getUser();
    if (user) {
      const { data: p } = await db.from('profiles').select('role, permissions').eq('id', user.id).maybeSingle();
      authed = p?.role === 'admin' || p?.permissions?.['crm.view'] === true;
    }
  }
  if (!authed) return json({ error: 'unauthorized' }, 401);

  // الصفوف (ترتيب ثابت بالهاتف — §6: أي range يحتاج order)
  const { data: rows, error } = await db.rpc('hatif_contact_labels')
    .order('phone', { ascending: true }).range(offset, offset + limit - 1);
  if (error) return json({ ok: false, error: `labels: ${error.message}` });
  const list: any[] = rows || [];

  const { count: total } = await db.from('hatif_contact_sync').select('phone', { count: 'exact', head: true });

  if (action === 'preview') {
    return json({ ok: true, preview: true, offset, returned: list.length,
      samples: list.slice(0, 5).map(r => ({ phone: r.phone, ...buildPayload(r) })), synced_so_far: total || 0 });
  }
  if (action !== 'sync') return json({ error: 'unknown action (preview|sync)' }, 400);

  let token: string;
  try { token = await accessToken(); } catch (e) { return json({ ok: false, error: String((e as Error).message || e) }); }

  // حالة المزامنة السابقة لهذه الدفعة
  const phones = list.map(r => r.phone);
  const { data: prev } = await db.from('hatif_contact_sync').select('phone, contact_id, payload_hash').in('phone', phones);
  const prevMap = new Map((prev || []).map((p: any) => [p.phone, p]));

  let created = 0, updated = 0, skipped = 0, failed = 0;
  const errors: unknown[] = [];

  for (const row of list) {
    const payload = buildPayload(row);
    const h = hash(JSON.stringify(payload));
    const st = prevMap.get(row.phone);
    if (st?.payload_hash === h && st?.contact_id) { skipped++; continue; }   // لا تغيّر → صفر استدعاء

    try {
      let cid: string | null = st?.contact_id || null;
      if (!cid) { cid = await findContactId(token, row.phone); await sleep(120); }

      let ok = false;
      if (cid) {
        const r = await fetch(`${CONTACTS_URL}/${cid}`, {
          method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        ok = r.ok; if (ok) updated++;
        if (!ok) errors.push({ phone: row.phone, step: 'update', status: r.status, body: (await r.text()).slice(0, 200) });
      } else {
        const r = await fetch(CONTACTS_URL, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ ...payload, phoneNumber: row.phone }),
        });
        ok = r.ok;
        if (ok) { created++; const nb = unwrap(await r.json().catch(() => ({}))); cid = nb?.id || nb?.contactId || null; }
        else errors.push({ phone: row.phone, step: 'create', status: r.status, body: (await r.text()).slice(0, 200) });
      }

      await db.from('hatif_contact_sync').upsert({
        phone: row.phone, contact_id: cid, payload_hash: ok ? h : null,
        synced_at: new Date().toISOString(), error: ok ? null : 'failed',
      }, { onConflict: 'phone' });
      if (!ok) failed++;
      await sleep(150);   // تهدئة ضد حصة Voxa
    } catch (e) {
      failed++; errors.push({ phone: row.phone, error: String((e as Error).message || e) });
    }
  }

  return json({ ok: true, offset, processed: list.length, created, updated, skipped, failed,
    nextOffset: list.length === limit ? offset + limit : null, errors: errors.slice(0, 5) });
});
