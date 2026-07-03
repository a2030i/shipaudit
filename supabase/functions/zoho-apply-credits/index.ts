// zoho-apply-credits v3 — تطبيق أرصدة العميل الدائنة على فواتيره المفتوحة.
// مهمة واحدة: لا إنشاء فواتير · لا حذف · لا شيء آخر.
//
// v3: الـendpoints الصحيحة المثبتة في مؤسسة المستخدم (POST /invoices/{}/credits
//     كان يُرفَض «not authorized»):
//   • الدفعات الزائدة → PUT /customerpayments/{id} (طريقة المستخدم في Deluge).
//     نجلب تطبيقاتها القائمة ونضمّها حتى لا يدهسها الـPUT.
//   • الإشعارات الدائنة → POST /creditnotes/{id}/invoices (إضافي، آمن).
// الصلاحيات: customerpayments.UPDATE + creditnotes.UPDATE (مُنِحت).

import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_ORIGIN = 'https://shipaudit-five.vercel.app';
const CORS = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const r2 = (n: number) => Math.round(n * 100) / 100;
const authErr = (m: string) => /authoriz|permission|scope/i.test(m || '');

const svc = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

async function requireUser(req: Request, db: ReturnType<typeof svc>) {
  const authHeader = req.headers.get('Authorization') || '';
  const uc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await uc.auth.getUser();
  if (!user) return null;
  const { data: p } = await db.from('profiles').select('role, permissions').eq('id', user.id).maybeSingle();
  return { user, role: p?.role || null, permissions: p?.permissions || {} };
}

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

// يبني خطة التطبيق مجمّعة حسب المصدر (إشعار/دفعة) — الأقدم من الفواتير أولاً.
async function buildPlan(token: string, apiDomain: string, orgId: string, contactId: string) {
  const H = { Authorization: `Zoho-oauthtoken ${token}` };
  const qs = (o: Record<string, string>) => new URLSearchParams({ organization_id: orgId, ...o }).toString();

  // الطلبات الثلاثة متوازية (كانت تسلسلية = بطء 3×).
  const [invRes, cnRes, payRes] = await Promise.all([
    fetch(`${apiDomain}/books/v3/invoices?${qs({ customer_id: contactId, status: 'unpaid', sort_column: 'date', sort_order: 'A', per_page: '200' })}`, { headers: H }),
    fetch(`${apiDomain}/books/v3/creditnotes?${qs({ customer_id: contactId, status: 'open', per_page: '200' })}`, { headers: H }),
    fetch(`${apiDomain}/books/v3/customerpayments?${qs({ customer_id: contactId, per_page: '200' })}`, { headers: H }),
  ]);
  const [invJ, cnJ, payJ] = await Promise.all([invRes.json(), cnRes.json(), payRes.json()]);
  if (invJ.code !== 0) throw new Error(`invoices: ${invJ.message || invJ.code}`);
  const invoices = (invJ.invoices || [])
    .filter((i: any) => Number(i.balance) > 0.001)
    .map((i: any) => ({ invoice_id: i.invoice_id, number: i.invoice_number, date: i.date, balance: Number(i.balance) }));
  const creditNotes = (cnJ.code === 0 ? (cnJ.creditnotes || []) : [])
    .map((c: any) => ({ creditnote_id: c.creditnote_id, number: c.creditnote_number, avail: Number(c.balance) }))
    .filter((c: any) => c.avail > 0.001);
  const excessPays = (payJ.code === 0 ? (payJ.customerpayments || []) : [])
    .map((p: any) => ({ payment_id: p.payment_id, ref: p.reference_number || p.payment_number, avail: Number(p.unused_amount) }))
    .filter((p: any) => p.avail > 0.001);

  const creditAvailable = r2(
    creditNotes.reduce((s: number, c: any) => s + c.avail, 0) +
    excessPays.reduce((s: number, p: any) => s + p.avail, 0),
  );

  // تجميع حسب المصدر: لكل إشعار/دفعة → أي فواتير وبكم.
  const cnApps = new Map<string, { number: string; invoices: any[] }>();
  const payApps = new Map<string, { ref: string; invoices: any[] }>();
  const plan: any[] = [];
  const cn = creditNotes.map((c: any) => ({ ...c }));
  const px = excessPays.map((p: any) => ({ ...p }));
  let totalApplied = 0;

  for (const inv of invoices) {
    let need = inv.balance;
    const detail: string[] = [];
    for (const c of cn) {
      if (need <= 0.001) break;
      if (c.avail <= 0.001) continue;
      const take = r2(Math.min(need, c.avail));
      c.avail = r2(c.avail - take); need = r2(need - take);
      if (!cnApps.has(c.creditnote_id)) cnApps.set(c.creditnote_id, { number: c.number, invoices: [] });
      cnApps.get(c.creditnote_id)!.invoices.push({ invoice_id: inv.invoice_id, amount_applied: take });
      detail.push(`إشعار ${c.number}: ${take}`);
    }
    for (const p of px) {
      if (need <= 0.001) break;
      if (p.avail <= 0.001) continue;
      const take = r2(Math.min(need, p.avail));
      p.avail = r2(p.avail - take); need = r2(need - take);
      if (!payApps.has(p.payment_id)) payApps.set(p.payment_id, { ref: p.ref, invoices: [] });
      payApps.get(p.payment_id)!.invoices.push({ invoice_id: inv.invoice_id, amount_applied: take });
      detail.push(`دفعة ${p.ref}: ${take}`);
    }
    const applied = r2(inv.balance - need);
    if (applied > 0.001) {
      totalApplied = r2(totalApplied + applied);
      plan.push({ invoice_id: inv.invoice_id, number: inv.number, date: inv.date, balance: inv.balance, applied, remaining: r2(need), detail });
    }
  }
  return {
    invoices_count: invoices.length, credit_available: creditAvailable, total_applied: totalApplied, plan,
    creditnote_apps: [...cnApps.entries()].map(([id, v]) => ({ creditnote_id: id, ...v })),
    payment_apps: [...payApps.entries()].map(([id, v]) => ({ payment_id: id, ...v })),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const db = svc();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* */ }
  const action = String(body.action || '');
  const contactId = String(body.contact_id || '');

  const auth = await requireUser(req, db);
  if (!auth) return json({ error: 'unauthorized — سجّل دخولك' }, 401);
  const isAdmin = auth.role === 'admin';
  const canRead = isAdmin || auth.permissions?.['money.pnl'] === true || auth.permissions?.['receivables.view'] === true;
  if (!canRead) return json({ error: 'forbidden' }, 403);
  if (!contactId) return json({ error: 'contact_id مطلوب' }, 400);

  try {
    const { token, apiDomain, orgId } = await accessToken(db);

    if (action === 'plan') {
      const result = await buildPlan(token, apiDomain, orgId, contactId);
      return json({ ok: true, ...result });
    }

    if (action === 'apply') {
      if (!isAdmin) return json({ error: 'forbidden — التطبيق للمدير فقط' }, 403);
      const result = await buildPlan(token, apiDomain, orgId, contactId);
      if (!result.plan.length) return json({ ok: true, applied: 0, results: [], note: 'لا شيء للتطبيق' });

      const H = { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' };
      const results: any[] = [];
      let appliedTotal = 0;

      // 1) الإشعارات الدائنة → POST /creditnotes/{id}/invoices (إضافي، آمن)
      for (const app of result.creditnote_apps) {
        const r = await fetch(`${apiDomain}/books/v3/creditnotes/${app.creditnote_id}/invoices?organization_id=${orgId}`, {
          method: 'POST', headers: H, body: JSON.stringify({ invoices: app.invoices }),
        });
        const j = await r.json().catch(() => ({}));
        const ok = j.code === 0;
        const sum = r2(app.invoices.reduce((s: number, x: any) => s + x.amount_applied, 0));
        if (ok) appliedTotal = r2(appliedTotal + sum);
        const err = ok ? null : (j.message || `code ${j.code}`);
        results.push({ source: `إشعار ${app.number}`, applied: sum, ok, error: err });
        if (!ok && authErr(err)) return json({ ok: true, applied: appliedTotal, count: results.filter(x => x.ok).length, results, role_error: true });
      }

      // 2) الدفعات الزائدة → PUT /customerpayments/{id} مع ضمّ التطبيقات القائمة
      for (const app of result.payment_apps) {
        // اجلب تطبيقات الدفعة القائمة حتى لا يدهسها الـPUT
        let existing: any[] = [];
        try {
          const gp = await fetch(`${apiDomain}/books/v3/customerpayments/${app.payment_id}?organization_id=${orgId}`, { headers: H });
          const gj = await gp.json();
          existing = (gj?.payment?.invoices || []).map((x: any) => ({ invoice_id: x.invoice_id, amount_applied: Number(x.amount_applied) }));
        } catch { /* لو فشل الجلب، نطبّق الجديد فقط */ }
        const merged = [...existing, ...app.invoices];
        const r = await fetch(`${apiDomain}/books/v3/customerpayments/${app.payment_id}?organization_id=${orgId}`, {
          method: 'PUT', headers: H, body: JSON.stringify({ invoices: merged }),
        });
        const j = await r.json().catch(() => ({}));
        const ok = j.code === 0;
        const sum = r2(app.invoices.reduce((s: number, x: any) => s + x.amount_applied, 0));
        if (ok) appliedTotal = r2(appliedTotal + sum);
        const err = ok ? null : (j.message || `code ${j.code}`);
        results.push({ source: `دفعة ${app.ref}`, applied: sum, ok, error: err });
        if (!ok && authErr(err)) return json({ ok: true, applied: appliedTotal, count: results.filter(x => x.ok).length, results, role_error: true });
      }

      return json({ ok: true, applied: appliedTotal, count: results.filter(x => x.ok).length, results });
    }

    return json({ error: 'action غير معروف (plan | apply)' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
