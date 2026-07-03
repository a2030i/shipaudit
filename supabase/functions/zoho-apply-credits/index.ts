// zoho-apply-credits v1 — مهمة واحدة محدّدة فقط: تطبيق أرصدة العميل الدائنة
// الموجودة (إشعارات دائنة + دفعات زائدة) على فواتيره المفتوحة الموجودة.
//
// ⚠️ حدود صارمة (قيد المستخدم 2026-07-03):
//   • لا يُنشئ فاتورة · لا يحذف فاتورة · لا يعدّل أي شيء آخر.
//   • العملية الوحيدة المسموحة: POST /invoices/{id}/credits (تطبيق رصيد
//     موجود على فاتورة موجودة). لا يوجد في هذا الملف أي POST/PUT/DELETE آخر.
//   • الصلاحية الدنيا = ZohoBooks.invoices.UPDATE (لا CREATE ولا DELETE).
//
// إجراءان:
//   plan  → قراءة فقط: يحسب خطة التطبيق (أي رصيد → أي فاتورة → كم) بلا كتابة.
//           يعمل بصلاحيات القراءة الحالية. (متاح لمن يملك money.pnl/admin)
//   apply → كتابة: ينفّذ الخطة عبر POST /invoices/{id}/credits. admin فقط.
//
// المصادقة الداخلية: نفس نمط zoho-sync (verify_jwt يقبل anon، فالحماية هنا).

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

// READ-ONLY: افتح فواتير العميل + أرصدته الدائنة، وابنِ خطة تطبيق (الأقدم أولاً).
async function buildPlan(token: string, apiDomain: string, orgId: string, contactId: string) {
  const H = { Authorization: `Zoho-oauthtoken ${token}` };
  const qs = (o: Record<string, string>) => new URLSearchParams({ organization_id: orgId, ...o }).toString();

  // 1) الفواتير المفتوحة (الأقدم أولاً)
  const invRes = await fetch(`${apiDomain}/books/v3/invoices?${qs({ customer_id: contactId, status: 'unpaid', sort_column: 'date', sort_order: 'A', per_page: '200' })}`, { headers: H });
  const invJ = await invRes.json();
  if (invJ.code !== 0) throw new Error(`invoices: ${invJ.message || invJ.code}`);
  // "unpaid" في زوهو يشمل partially_paid أيضاً؛ نأخذ ما له رصيد > 0
  const invoices = (invJ.invoices || [])
    .filter((i: any) => Number(i.balance) > 0.001)
    .map((i: any) => ({ invoice_id: i.invoice_id, number: i.invoice_number, date: i.date, balance: Number(i.balance) }));

  // 2) الإشعارات الدائنة المتاحة
  const cnRes = await fetch(`${apiDomain}/books/v3/creditnotes?${qs({ customer_id: contactId, status: 'open', per_page: '200' })}`, { headers: H });
  const cnJ = await cnRes.json();
  const creditNotes = (cnJ.code === 0 ? (cnJ.creditnotes || []) : [])
    .map((c: any) => ({ creditnote_id: c.creditnote_id, number: c.creditnote_number, avail: Number(c.balance) }))
    .filter((c: any) => c.avail > 0.001);

  // 3) الدفعات الزائدة (المبلغ غير المستخدم)
  const payRes = await fetch(`${apiDomain}/books/v3/customerpayments?${qs({ customer_id: contactId, per_page: '200' })}`, { headers: H });
  const payJ = await payRes.json();
  const excessPays = (payJ.code === 0 ? (payJ.customerpayments || []) : [])
    .map((p: any) => ({ payment_id: p.payment_id, ref: p.reference_number || p.payment_number, avail: Number(p.unused_amount) }))
    .filter((p: any) => p.avail > 0.001);

  const creditAvailable = r2(
    creditNotes.reduce((s: number, c: any) => s + c.avail, 0) +
    excessPays.reduce((s: number, p: any) => s + p.avail, 0),
  );

  // خطة: لكل فاتورة (الأقدم أولاً) اسحب من الإشعارات ثم الدفعات الزائدة حتى تُسدَّد.
  const cn = creditNotes.map((c: any) => ({ ...c }));
  const px = excessPays.map((p: any) => ({ ...p }));
  const plan: any[] = [];
  let totalApplied = 0;
  for (const inv of invoices) {
    let need = inv.balance;
    const useCn: any[] = [], usePay: any[] = [];
    for (const c of cn) {
      if (need <= 0.001) break;
      if (c.avail <= 0.001) continue;
      const take = r2(Math.min(need, c.avail));
      c.avail = r2(c.avail - take); need = r2(need - take);
      useCn.push({ creditnote_id: c.creditnote_id, number: c.number, amount_applied: take });
    }
    for (const p of px) {
      if (need <= 0.001) break;
      if (p.avail <= 0.001) continue;
      const take = r2(Math.min(need, p.avail));
      p.avail = r2(p.avail - take); need = r2(need - take);
      usePay.push({ payment_id: p.payment_id, ref: p.ref, amount_applied: take });
    }
    const applied = r2(inv.balance - need);
    if (applied > 0.001) {
      totalApplied = r2(totalApplied + applied);
      plan.push({
        invoice_id: inv.invoice_id, number: inv.number, date: inv.date,
        balance: inv.balance, applied, remaining: r2(need),
        apply_creditnotes: useCn.map(({ creditnote_id, amount_applied }) => ({ creditnote_id, amount_applied })),
        apply_customer_payments: usePay.map(({ payment_id, amount_applied }) => ({ payment_id, amount_applied })),
        detail: [...useCn.map((c) => `إشعار ${c.number}: ${c.amount_applied}`), ...usePay.map((p) => `دفعة ${p.ref}: ${p.amount_applied}`)],
      });
    }
  }
  return {
    invoices_count: invoices.length,
    credit_available: creditAvailable,
    total_applied: totalApplied,
    plan,
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

    // ── plan: قراءة فقط ──
    if (action === 'plan') {
      const result = await buildPlan(token, apiDomain, orgId, contactId);
      return json({ ok: true, ...result });
    }

    // ── apply: كتابة — admin فقط، العملية الوحيدة المسموحة ──
    if (action === 'apply') {
      if (!isAdmin) return json({ error: 'forbidden — التطبيق للمدير فقط' }, 403);
      const result = await buildPlan(token, apiDomain, orgId, contactId);
      if (!result.plan.length) return json({ ok: true, applied: 0, results: [], note: 'لا شيء للتطبيق' });

      const H = { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' };
      const results: any[] = [];
      let appliedTotal = 0;
      for (const p of result.plan) {
        // العملية الوحيدة: تطبيق رصيد موجود على فاتورة موجودة. لا إنشاء ولا حذف.
        const r = await fetch(`${apiDomain}/books/v3/invoices/${p.invoice_id}/credits?organization_id=${orgId}`, {
          method: 'POST',
          headers: H,
          body: JSON.stringify({
            apply_creditnotes: p.apply_creditnotes,
            apply_customer_payments: p.apply_customer_payments,
          }),
        });
        const j = await r.json().catch(() => ({}));
        const ok = j.code === 0;
        if (ok) appliedTotal = r2(appliedTotal + p.applied);
        results.push({ invoice: p.number, applied: p.applied, ok, error: ok ? null : (j.message || `code ${j.code}`) });
      }
      return json({ ok: true, applied: appliedTotal, count: results.filter(r => r.ok).length, results });
    }

    return json({ error: 'action غير معروف (plan | apply)' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
