// zoho-reports v4 — تقارير زوهو الرسمية للتصدير (الإقرار الضريبي + قائمة الدخل).
//
// لماذا دالة منفصلة عن `zoho-sync`؟ المزامنة مسؤولية حرجة تعمل بكرون كل 30
// دقيقة — فصل التقارير يمنع أي تعديل تقريري من كسرها. نفس نمط المصادقة
// والتوكن حرفياً (requireUser + canPnl + refresh_token من zoho_auth).
//
// لماذا من زوهو مباشرةً لا من المرايا المحلية؟ المرايا تحمل **الإجمالي
// الشامل فقط** بلا تفصيل ضريبي (لا sub_total ولا tax_total)، وقسمة تقديرية
// ÷1.15 لا تصلح لإقرار رسمي: الفواتير الصفرية/المعفاة (تصدير، خدمات دولية)
// تُحسب غلطاً فيخرج إقرار خاطئ. زوهو هو مصدر الحقيقة الضريبية.
//
// الإجراءات:
//   tax_report { from, to }  → يجرّب مسارات تقارير الضريبة ويرجع ما ينجح
//   pnl_range  { from, to }  → قائمة الدخل لأي فترة (لا شهر فقط) + تفصيل الحسابات
//
// **قراءة فقط** — لا كتابة في زوهو إطلاقاً (قاعدة المستخدم الثابتة §1.26).

import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_ORIGIN = 'https://shipaudit-five.vercel.app';
const CORS = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const svc = () => createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

async function requireUser(req: Request, db: ReturnType<typeof svc>) {
  const authHeader = req.headers.get('Authorization') || '';
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return null;
  const { data: profile } = await db.from('profiles')
    .select('role, permissions').eq('id', user.id).maybeSingle();
  return { user, role: profile?.role || null, permissions: profile?.permissions || {} };
}
const canPnl = (a: { role: string | null; permissions: Record<string, unknown> }) =>
  a.role === 'admin' || a.permissions?.['money.pnl'] === true;

async function accessToken(db: ReturnType<typeof svc>) {
  const { data } = await db.from('zoho_auth').select('*').eq('id', 1).maybeSingle();
  if (!data?.refresh_token) throw new Error('لا ربط بعد');
  const r = await fetch(`https://${data.accounts_domain}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: Deno.env.get('ZOHO_CLIENT_ID')!,
      client_secret: Deno.env.get('ZOHO_CLIENT_SECRET')!,
      refresh_token: data.refresh_token,
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`refresh failed: ${JSON.stringify(j)}`);
  return { token: j.access_token as string, apiDomain: data.api_domain as string, orgId: data.org_id as string };
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* بلا جسم */ }
  const action = String(body.action || 'tax_report');
  const db = svc();

  try {
    // هوية آلية بمفتاح الكرون (نفس نمط zoho-sync) — للتقارير المجدولة
    // وللتحقق التشغيلي. عدا ذلك: جلسة مستخدم + صلاحية «الوضع المالي».
    let auth: Awaited<ReturnType<typeof requireUser>> = null;
    const cronKey = req.headers.get('X-Cron-Key') || req.headers.get('x-cron-key');
    if (cronKey) {
      const { data: za } = await db.from('zoho_auth').select('cron_key').eq('id', 1).maybeSingle();
      if (za?.cron_key && za.cron_key === cronKey) {
        auth = { user: null as never, role: 'admin', permissions: {} };
      }
    }
    if (!auth) auth = await requireUser(req, db);
    if (!auth) return json({ error: 'unauthorized — سجّل دخولك' }, 401);
    if (!canPnl(auth)) return json({ error: 'forbidden — تحتاج صلاحية «الوضع المالي»' }, 403);

    const { token, apiDomain, orgId } = await accessToken(db);
    const auth_h = { Authorization: `Zoho-oauthtoken ${token}` };

    // ── استكشاف مرن (مدير فقط) — يغني عن نشرة جديدة لكل تجربة،
    //    ومحصور في نطاق زوهو (المسار يُلحق بـapiDomain).
    if (action === 'raw') {
      if (auth.role !== 'admin') return json({ error: 'forbidden — للمدير فقط' }, 403);
      const list = Array.isArray(body.paths) ? (body.paths as string[]) : [];
      if (!list.length) return json({ error: 'paths[] مطلوبة' }, 400);
      const out: Record<string, unknown> = {};
      for (const raw of list.slice(0, 12)) {
        const p = String(raw).replace(/^\/+/, '');
        try {
          const sep = p.includes('?') ? '&' : '?';
          const r = await fetch(`${apiDomain}/books/v3/${p}${sep}organization_id=${orgId}`, { headers: auth_h });
          const j = await r.json().catch(() => ({}));
          out[p] = { http: r.status, code: j.code ?? null, message: j.message ?? null,
                     keys: Object.keys(j), body: j.code === 0 ? j : undefined };
        } catch (e) { out[p] = { error: String((e as Error).message || e) }; }
      }
      return json({ ok: true, results: out });
    }

    const from = String(body.from || '');
    const to   = String(body.to || '');
    if (!isDate(from) || !isDate(to)) return json({ error: 'bad from/to — YYYY-MM-DD' }, 400);

    // ── الإقرار الضريبي ──────────────────────────────────────────────
    if (action === 'tax_report') {
      // ⚠️ `filter_by=TransactionDate.CustomDate` **إلزامي**: بدونه يتجاهل زوهو
      // from_date/to_date تماماً ويُرجع فترته الافتراضية — أي **نفس الأرقام لكل
      // ربع** (مُتحقَّق 2026-07-28: الربع1 والربع2 عادا متطابقين حرفياً قبل
      // إضافته). لا تحذفه أبداً — النتيجة إقرار ضريبي خاطئ بصمت.
      const qs = new URLSearchParams({
        organization_id: orgId, from_date: from, to_date: to,
        cash_based: 'false', filter_by: 'TransactionDate.CustomDate',
      });
      const paths = [
        `reports/vatsummary?${qs}`,
        `reports/taxsummary?${qs}`,
      ];
      const out: Record<string, unknown> = {};
      for (const p of paths) {
        const key = p.split('?')[0];
        try {
          const r = await fetch(`${apiDomain}/books/v3/${p}`, { headers: auth_h });
          const j = await r.json().catch(() => ({}));
          out[key] = (j.code === 0)
            ? { ok: true, http: r.status, data: j }
            : { ok: false, http: r.status, code: j.code ?? null, message: j.message ?? null };
        } catch (e) {
          out[key] = { ok: false, error: String((e as Error).message || e) };
        }
      }
      return json({ ok: true, from, to, reports: out });
    }

    // ── قائمة الدخل لأي فترة (ربع/سنة/مخصّص) ─────────────────────────
    if (action === 'pnl_range') {
      const qs = new URLSearchParams({
        organization_id: orgId, from_date: from, to_date: to,
        cash_based: 'false', filter_by: 'TransactionDate.CustomDate',
      });
      const r = await fetch(`${apiDomain}/books/v3/reports/profitandloss?${qs}`, { headers: auth_h });
      const j = await r.json();
      if (j.code !== 0) return json({ error: `zoho: ${j.message || JSON.stringify(j)}`, code: j.code }, 400);
      return json({ ok: true, from, to, profit_and_loss: j.profit_and_loss ?? j });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
