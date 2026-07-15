// hatif-contacts-sync v2 — يدفع ملف العميل إلى **Contact Properties** في هاتف
// (الآلية الوحيدة التي تظهر للموظف في البروفايل — customFields تُخزَّن لكنها مخفيّة،
// وحقل note يُضيف نسخة كل مرة ولا يُحذف برمجياً، فكلاهما مرفوض هنا).
//
// ⚠️ هاتف لا يوفّر ربط Tag بجهة اتصال (Tags API = تعريف الوسم فقط، 53 مساراً
// مراجَعة). البديل المعتمد: خصائص من نوع **قائمة (3)** بقيَم ملوّنة = شارات بصرية.
//
// المصدر: RPC hatif_contact_profile() — موحّد بالهاتف المطبَّع، الاسم = أعلى متجر
// شحناً، details = سرد لكل متجر. حصة Voxa: hatif_contact_sync يخزّن contact_id
// وبصمة الحمولة فلا نستدعي هاتف إلا للمتغيّر.
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
const PROPDEF_URL = 'https://api.voxa.sa/v1/contact-property-definitions';

// تعريفات الخصائص (تُنشأ مرة). type: 1=نص 2=رقم 3=قائمة ملوّنة 4=تاريخ
const PROP_DEFS: { name: string; type: number; options?: { value: string; color: string }[] }[] = [
  { name: 'الحالة',  type: 3, options: [{ value: 'نشط', color: '#22C55E' }, { value: 'متوقف', color: '#EF4444' }, { value: 'جديد', color: '#3B82F6' }] },
  { name: 'التصنيف', type: 3, options: [{ value: 'VIP', color: '#D97706' }, { value: 'عادي', color: '#9CA3AF' }] },
  { name: 'المديونية', type: 3, options: [{ value: 'عليه مديونية', color: '#EF4444' }, { value: 'سليم', color: '#22C55E' }] },
  { name: 'إجمالي المديونية', type: 2 },
  { name: 'آخر شحنة', type: 4 },
  { name: 'تاريخ الانضمام', type: 4 },
  { name: 'تفاصيل المتاجر', type: 1 },
];

function hash(s: string) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h >>> 0); }
function normPhone(raw: unknown) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('966')) return '966' + d.slice(3).replace(/^0+/, '');
  if (d.length === 10 && d.startsWith('05')) return '966' + d.slice(1);
  if (d.length === 9 && d.startsWith('5')) return '966' + d;
  return d;
}
const unwrap = (j: any) => (j && typeof j === 'object' && 'id' in j && typeof j.id === 'object') ? j.id : j;

let tokenCache: { token: string; exp: number } | null = null;
async function accessToken() {
  if (tokenCache && tokenCache.exp > Date.now()) return tokenCache.token;
  const id = env('client_id', 'HATIF_CLIENT_ID'), secret = env('secret', 'HATIF_CLIENT_SECRET');
  if (!id || !secret) throw new Error('أسرار Hatif غير مضبوطة');
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret, scope: 'VoxaAPI' }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('فشل توكن Hatif');
  tokenCache = { token: j.access_token, exp: Date.now() + ((Number(j.expires_in) || 3600) * 1000) - 60000 };
  return tokenCache.token;
}

// يضمن وجود التعريفات ويُرجِع الاسم → id
async function ensureProps(token: string) {
  const r = await fetch(PROPDEF_URL, { headers: { Authorization: `Bearer ${token}` } });
  const b = unwrap(await r.json().catch(() => ({})));
  const existing: any[] = Array.isArray(b) ? b : (b?.items || []);
  const map = new Map<string, string>();
  for (const d of existing) if (d?.name && d?.id) map.set(d.name, d.id);
  for (const def of PROP_DEFS) {
    if (map.has(def.name)) continue;
    const body: Record<string, unknown> = { name: def.name, type: def.type, isRequired: false };
    if (def.options) body.selectOptions = def.options;
    const cr = await fetch(PROPDEF_URL, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const cb = unwrap(await cr.json().catch(() => ({})));
    if (cb?.id) map.set(def.name, cb.id);
    await sleep(120);
  }
  return map;
}

// قيَم الخصائص لعميل — القيم الفارغة تُحذف (لا نملأ حقولاً بلا معنى)
function propValues(row: any): Record<string, string | number> {
  const v: Record<string, string | number> = {
    'الحالة': row.status_val,
    'التصنيف': row.class_val,
    'المديونية': row.debt_val,
    'تفاصيل المتاجر': row.details || '',
  };
  if (Number(row.debt) > 0.5) v['إجمالي المديونية'] = Math.round(Number(row.debt));
  if (row.last_shipment_at) v['آخر شحنة'] = String(row.last_shipment_at);
  if (row.joined_at) v['تاريخ الانضمام'] = String(row.joined_at);
  for (const k of Object.keys(v)) if (v[k] === '' || v[k] == null) delete v[k];
  return v;
}

async function findContactId(token: string, phone: string) {
  const r = await fetch(`${CONTACTS_URL}?SkipCount=0&MaxResultCount=10&phoneNumber=${encodeURIComponent(phone)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const items: any[] = unwrap(await r.json().catch(() => ({})))?.items || [];
  const dg = (v: unknown) => String(v || '').replace(/\D/g, '');
  return items.find(c => dg(c.phoneNumber) === dg(phone))?.id || null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const db = svc();
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* */ }
  const action = String(body.action || 'preview');
  const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 200);
  const offset = Math.max(Number(body.offset) || 0, 0);
  const all = body.all === true;
  const maxWrites = Math.min(Math.max(Number(body.maxWrites) || 50, 1), 200);   // عميل واحد = ~7 استدعاءات

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

  // ⚠️ PostgREST يسقّف نتيجة الـRPC عند **1000 صف** (إعداد سيرفري لا يرفعه range)،
  // فوضع all يجب أن يجلب على صفحات وإلا فقدنا 455 عميلاً صامتاً.
  const onePhone = body.phone ? normPhone(body.phone) : null;
  let list: any[] = [];
  if (onePhone) {
    const { data, error } = await db.rpc('hatif_contact_profile').eq('phone', onePhone);
    if (error) return json({ ok: false, error: `profile: ${error.message}` });
    list = data || [];
  } else if (all) {
    for (let off = 0; off < 20000; off += 1000) {
      const { data, error } = await db.rpc('hatif_contact_profile').order('phone', { ascending: true }).range(off, off + 999);
      if (error) return json({ ok: false, error: `profile: ${error.message}` });
      const chunk = data || [];
      list.push(...chunk);
      if (chunk.length < 1000) break;
    }
  } else {
    const { data, error } = await db.rpc('hatif_contact_profile').order('phone', { ascending: true }).range(offset, offset + limit - 1);
    if (error) return json({ ok: false, error: `profile: ${error.message}` });
    list = data || [];
  }
  if (onePhone && !list.length) return json({ ok: false, error: `الرقم ${onePhone} ليس ضمن كشف المتاجر` });

  if (action === 'preview') {
    return json({ ok: true, preview: true, returned: list.length,
      samples: list.slice(0, 3).map(r => ({ phone: r.phone, name: r.name, props: propValues(r) })) });
  }

  // سرد تعريفات الخصائص (فحص)
  if (action === 'props') {
    const token = await accessToken();
    if (body.delete) {
      const dr = await fetch(`${PROPDEF_URL}/${body.delete}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      return json({ ok: dr.ok, status: dr.status, deleted: body.delete });
    }
    const r = await fetch(PROPDEF_URL, { headers: { Authorization: `Bearer ${token}` } });
    const b = unwrap(await r.json().catch(() => ({})));
    const defs: any[] = Array.isArray(b) ? b : (b?.items || []);
    return json({ ok: r.ok, count: defs.length, defs: defs.map((d: any) => ({ id: d.id, name: d.name, type: d.type })) });
  }

  // جرد: من في هاتف وليس عندنا (والعكس) — مقارنة بالهاتف المطبَّع
  if (action === 'audit') {
    const token = await accessToken();
    const ours = new Set(list.map((r: any) => r.phone));
    const hatifOnly: any[] = [];
    let skip = 0, total = 0, scanned = 0;
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {   // سقف أمان
      const r = await fetch(`${CONTACTS_URL}?SkipCount=${skip}&MaxResultCount=200`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) break;
      const b = unwrap(await r.json().catch(() => ({})));
      total = b?.totalCount ?? total;
      const items: any[] = b?.items || [];
      if (!items.length) break;
      for (const c of items) {
        scanned++;
        const np = normPhone(c.phoneNumber);
        if (np) seen.add(np);
        if (!np || ours.has(np)) continue;
        // نحتفظ بالجوال السعودي فقط — الثابت/الموحّد/الأجنبي لا يُستهدَف بحملة
        // واتساب (قرار المستخدم 2026-07-15) فلا نسحبه أصلاً.
        if (!/^9665\d{8}$/.test(np)) continue;
        // سمّاه موظف؟ الاسم الحقيقي يحوي **حرفاً** — «920006546» هو الرقم بصيغة
        // محلية لا اسم (كان يُعدّ اسماً يدوياً غلطاً).
        const nm = String(c.name || '').trim();
        const named = !!nm && /\p{L}/u.test(nm);
        const kind = /^9665\d{8}$/.test(np) ? 'mobile_sa'
          : /^966(9200|800)\d+$/.test(np) ? 'service_sa'        // موحّد/مجاني = شركات
          : /^966[1-4]\d{8}$/.test(np) ? 'landline_sa'          // ثابت (كان \d{7} فيفوته)
          : np.startsWith('966') ? 'other' : 'foreign';
        hatifOnly.push({ phone: np, contact_id: c.id, name: named ? nm : null, company: c.company || null,
          named_manually: named, phone_kind: kind, created_at_hatif: c.creationTime || null });
      }
      skip += items.length;
      if (skip >= total) break;
      await sleep(80);
    }
    const oursOnly = [...ours].filter(p => !seen.has(p));

    // الحفظ عندنا (upsert — الحالة/الملاحظة/الإسناد التي يضعها الفريق لا تُدهس)
    let saved = 0;
    if (body.save) {
      const now = new Date().toISOString();
      for (let i = 0; i < hatifOnly.length; i += 500) {
        const chunk = hatifOnly.slice(i, i + 500).map(x => ({ ...x, last_seen: now, updated_at: now }));
        const { error: ue } = await db.from('hatif_unknown_contacts')
          .upsert(chunk, { onConflict: 'phone', ignoreDuplicates: false });
        if (!ue) saved += chunk.length;
      }
    }

    const by = (k: string, v: string) => hatifOnly.filter((x: any) => x[k] === v).length;
    return json({ ok: true, hatif_total: total, scanned, ours_total: ours.size,
      in_hatif_not_ours: hatifOnly.length, in_ours_not_hatif: oursOnly.length, saved,
      named_manually: hatifOnly.filter((x: any) => x.named_manually).length,
      kinds: { mobile_sa: by('phone_kind', 'mobile_sa'), landline_sa: by('phone_kind', 'landline_sa'),
               foreign: by('phone_kind','foreign'), other: by('phone_kind','other'), service_sa: by('phone_kind','service_sa') },
      samples: hatifOnly.filter((x: any) => x.named_manually).slice(0, 12) });
  }

  // قراءة رجعية — ماذا خزّن هاتف فعلاً
  if (action === 'inspect') {
    if (!onePhone) return json({ ok: false, error: 'phone مطلوب' });
    const token = await accessToken();
    const r = await fetch(`${CONTACTS_URL}?SkipCount=0&MaxResultCount=10&phoneNumber=${encodeURIComponent(onePhone)}`, { headers: { Authorization: `Bearer ${token}` } });
    const items: any[] = unwrap(await r.json().catch(() => ({})))?.items || [];
    const dg = (v: unknown) => String(v || '').replace(/\D/g, '');
    const hit = items.find(c => dg(c.phoneNumber) === dg(onePhone)) || items[0] || null;
    return json({ ok: r.ok, contact: hit ? { name: hit.name, phoneNumber: hit.phoneNumber, company: hit.company,
      position: hit.position, customProperties: hit.customProperties, notes_count: (hit.notes || []).length } : null });
  }

  // إصلاح الأسماء التي كتبتها مزامنة سابقة بلاحقة «(+N متاجر)» — نمط يخصّنا وحدنا،
  // فلا نمسّ اسماً أدخله الفريق. الاسم الصحيح = أعلى متجر شحناً.
  if (action === 'fixnames') {
    const token = await accessToken();
    const SUFFIX = /\s*\(\+\d+\s*متاجر\)\s*$/;
    // بحث هاتف بالاسم يجد المصابين مباشرة (بدل مسح 1455 جهة)
    const sr = await fetch(`${CONTACTS_URL}?SkipCount=0&MaxResultCount=500&name=${encodeURIComponent('متاجر)')}`,
      { headers: { Authorization: `Bearer ${token}` } });
    const hits: any[] = unwrap(await sr.json().catch(() => ({})))?.items || [];
    const byPhone = new Map(list.map((r: any) => [r.phone, r.name]));
    let fixed = 0, untouched = 0;
    const samples: unknown[] = [];
    for (const c of hits) {
      if (fixed >= maxWrites) break;
      if (!c?.name || !SUFFIX.test(c.name)) { untouched++; continue; }   // ليس من صنعنا → لا نلمسه
      const want = byPhone.get(normPhone(c.phoneNumber));
      if (!want || want === c.name) { untouched++; continue; }
      const pr = await fetch(`${CONTACTS_URL}/${c.id}`, { method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: want }) });
      if (pr.ok) { fixed++; if (samples.length < 4) samples.push({ from: c.name, to: want }); }
      await sleep(90);
    }
    return json({ ok: true, found: hits.length, fixed, untouched, samples });
  }

  if (action !== 'sync') return json({ error: 'unknown action (preview|props|inspect|fixnames|sync)' }, 400);

  let token: string, props: Map<string, string>;
  try { token = await accessToken(); props = await ensureProps(token); }
  catch (e) { return json({ ok: false, error: String((e as Error).message || e) }); }

  const { data: prev } = all || onePhone
    ? await db.from('hatif_contact_sync').select('phone, contact_id, payload_hash')
    : await db.from('hatif_contact_sync').select('phone, contact_id, payload_hash').in('phone', list.map(r => r.phone));
  const prevMap = new Map((prev || []).map((p: any) => [p.phone, p]));

  let created = 0, updated = 0, skipped = 0, failed = 0, writes = 0, remaining = 0;
  const errors: unknown[] = [];

  for (const row of list) {
    const vals = propValues(row);
    const h = hash(JSON.stringify({ n: row.name, v: vals }));
    const st = prevMap.get(row.phone);
    if (st?.payload_hash === h && st?.contact_id) { skipped++; continue; }
    if (writes >= maxWrites) { remaining++; continue; }
    writes++;

    try {
      let cid: string | null = st?.contact_id || null;
      let isNew = false;
      if (!cid) { cid = await findContactId(token, row.phone); await sleep(100); }
      if (!cid) {
        // جهة جديدة: الاسم = أعلى متجر شحناً (يُكتب عند الإنشاء فقط)
        const cr = await fetch(CONTACTS_URL, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ name: row.name || row.phone, phoneNumber: row.phone }) });
        if (!cr.ok) { failed++; errors.push({ phone: row.phone, step: 'create', status: cr.status, body: (await cr.text()).slice(0, 150) }); continue; }
        cid = unwrap(await cr.json().catch(() => ({})))?.id || null;
        isNew = true; created++;
        await sleep(100);
      }
      if (!cid) { failed++; errors.push({ phone: row.phone, step: 'no-cid' }); continue; }

      // ضبط قيم الخصائص (تُستبدَل — لا تتراكم)
      let bad = 0;
      for (const [pname, pval] of Object.entries(vals)) {
        const pid = props.get(pname);
        if (!pid) continue;
        const pr = await fetch(`${CONTACTS_URL}/${cid}/properties/${pid}`, {
          method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ value: pval }) });
        if (!pr.ok) { bad++; if (errors.length < 5) errors.push({ phone: row.phone, prop: pname, status: pr.status, body: (await pr.text()).slice(0, 120) }); }
        await sleep(90);
      }
      const ok = bad === 0;
      if (ok && !isNew) updated++;
      if (!ok) failed++;
      await db.from('hatif_contact_sync').upsert({
        phone: row.phone, contact_id: cid, payload_hash: ok ? h : null,
        synced_at: new Date().toISOString(), error: ok ? null : `${bad} خاصية فشلت`,
      }, { onConflict: 'phone' });
    } catch (e) {
      failed++; errors.push({ phone: row.phone, error: String((e as Error).message || e) });
    }
  }

  return json({ ok: true, offset, processed: list.length, created, updated, skipped, failed, remaining,
    nextOffset: (!all && !onePhone && list.length === limit) ? offset + limit : null, errors: errors.slice(0, 5) });
});
