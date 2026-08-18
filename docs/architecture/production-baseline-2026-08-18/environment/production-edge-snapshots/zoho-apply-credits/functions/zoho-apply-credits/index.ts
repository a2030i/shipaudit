// zoho-apply-credits v12 — تطبيق أرصدة العميل الدائنة على فواتيره المفتوحة.
// v12: كاش التوكن يُبطَل فور إعادة المنح (يقارن zoho_auth.updated_at) — فالنطاق
//      الجديد (creditnotes.CREATE) يسري لحظياً لا بعد 55 دقيقة.
// مهمة واحدة: لا إنشاء فواتير · لا حذف · لا شيء آخر.
//
// v3: الـendpoints الصحيحة المثبتة في مؤسسة المستخدم (POST /invoices/{}/credits
//     كان يُرفَض «not authorized»):
//   • الدفعات الزائدة → PUT /customerpayments/{id} (طريقة المستخدم في Deluge).
//     نجلب تطبيقاتها القائمة ونضمّها حتى لا يدهسها الـPUT.
//   • الإشعارات الدائنة → POST /creditnotes/{id}/invoices (إضافي، آمن).
// v4: buildPlan يجلب الفواتير+الإشعارات+الدفعات بالتوازي (Promise.all) — بطء أقل.
// v5: كل تطبيق مُقيَّد بالرصيد الحيّ (capAlloc) لتفادي رفض زوهو «المبلغ أكثر من
//     الرصيد المستحق» عند حدود التقريب/بعد الإشعارات؛ قائمة الدفعة موحّدة بلا
//     تكرار فاتورة؛ كل مصدر ملفوف بـtry فلا يُسقِط فشلٌ واحدٌ الدفعة كلها (500).
// v6: جلب الفواتير المفتوحة بالرصيد>0 (يشمل «overdue») لا بفلتر status=unpaid —
//     كان يُسقِط الفواتير المتأخرة فتظهر «لا فواتير مفتوحة» لعميل دينه كله متأخر.
// v7: حصة زوهو (~100/دقيقة): إعادة محاولة تصاعدية على 429 (zfetch)، إعادة
//     استخدام فواتير buildPlan كأرصدة حيّة (جلب أقل)، ورسالة «الحصة ممتلئة»
//     ودّية (rate_limited) بدل 500 — الواجهة تنتظر دقيقة وتُكمل بأمان.
// v8: تقليل طلبات زوهو أكثر: كاش رمز الوصول (ساعة) فلا تحديث كل استدعاء،
//     وكاش خطة قصير (90ث) فيعيد apply استخدام قراءات المعاينة بدل تكرارها.
// v9: عند رفض «المبلغ أكثر من الرصيد» (سباق Deluce/تقادم الكاش) نعيد جلب
//     الأرصدة الطازجة مرة واحدة، نعيد القصّ عليها، ونحاول مرة أخيرة — للإشعارات
//     والدفعات معاً. الجلب الطازج فقط عند الرفض (لا يُثقِل الحصة عادةً).
// v10: المحاولة الثانية تنطلق على **أي** فشل (لا نطابق نص عربي هشّاً)، ونعيد
//      جلب تطبيقات الدفعة القائمة الطازجة (قد يغيّرها Deluge)، مع console.error
//      للاستجابة الخام لتشخيص الرفض المتبقّي.
// v11: بناء الخطة من **المرآة المحلية** (zoho_invoices/creditnotes/payments)
//      بلا استدعاء زوهو حيّ — صفر قراءات في الحالة الطبيعية (فكرة المستخدم:
//      احفظ الأرقام). fallback حيّ عند فراغ المرآة؛ getFresh يصحّح التقادم.
// الصلاحيات: customerpayments.UPDATE + creditnotes.UPDATE (مُنِحت).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { claimWriteOperation, finishWriteOperation } from '../_shared/zohoReliability.ts';

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
// كشف تجاوز حصة زوهو (~100 طلب/دقيقة للمؤسسة).
const rateLimited = (m: string) => /rate.?limit|too many requests|per minute|exceeded.*(calls|requests)|\b429\b/i.test(m || '');
// كشف رفض «المبلغ أكثر من الرصيد المستحق» — يعني أن رصيدنا المرجعي بات قديماً
// (تطبيق متزامن من Deluge أو تقادم كاش الخطة) فنعيد الجلب الطازج ونحاول ثانية.
const overBalance = (m: string) => /أكثر من الرصيد|more than the (balance|amount|outstanding)|exceeds? the/i.test(m || '');
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// fetch مع إعادة محاولة تصاعدية على 429 (حصة زوهو) — النافذة دقيقة متدحرجة
// فبضع ثوانٍ كافية غالباً لتحرّر جزء من الحصة. لا نعيد على أخطاء أخرى.
async function zfetch(url: string, opts: RequestInit = {}) {
  const backoff = [1500, 3000, 6000, 9000];
  let r = await fetch(url, opts);
  for (let i = 0; r.status === 429 && i < backoff.length; i++) {
    await sleep(backoff[i]);
    r = await fetch(url, opts);
  }
  return r;
}

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

// كاش رمز الوصول على مستوى الـinstance — توكن زوهو يدوم ساعة، فلا داعي
// لتحديثه كل استدعاء (يقلّل طلبات زوهو ويسرّع). best-effort (قد يُعاد تدوير
// الـinstance فيُعاد التحديث — لا ضرر).
let tokenCache: { token: string; apiDomain: string; orgId: string; exp: number; grantAt: number } | null = null;
async function accessToken(db: ReturnType<typeof svc>) {
  if (tokenCache && tokenCache.exp > Date.now()) {
    // تأكّد أن الربط لم يُعَد منحه (updated_at) — وإلا أبطِل الكاش لأخذ النطاق الجديد فوراً
    const { data: chk } = await db.from('zoho_auth').select('updated_at').eq('id', 1).maybeSingle();
    if (!chk?.updated_at || new Date(chk.updated_at).getTime() <= tokenCache.grantAt) return tokenCache;
    tokenCache = null;   // أُعيد المنح → توكن جديد بالنطاق الجديد
  }
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
  tokenCache = { token: j.access_token as string, apiDomain: data.api_domain as string, orgId: data.org_id as string,
    exp: Date.now() + 55 * 60 * 1000, grantAt: data.updated_at ? new Date(data.updated_at).getTime() : Date.now() };
  return tokenCache;
}

// الفواتير المفتوحة للعميل (رصيد>0، الأقدم أولاً) — **بالرصيد لا بالحالة**.
// فلتر status=unpaid في زوهو يُسقِط الفواتير «overdue» (المتأخرة تُصنَّف حالة
// منفصلة) فيظهر «لا فواتير مفتوحة» لعميل دينه كله متأخر. نجلب كل الصفحات
// ونستبعد المسودّة/الملغاة فقط.
async function fetchOpenInvoices(token: string, apiDomain: string, orgId: string, contactId: string) {
  const H = { Authorization: `Zoho-oauthtoken ${token}` };
  const out: any[] = [];
  for (let page = 1; page <= 20; page++) {
    const qs = new URLSearchParams({ organization_id: orgId, customer_id: contactId, sort_column: 'date', sort_order: 'A', per_page: '200', page: String(page) });
    const r = await zfetch(`${apiDomain}/books/v3/invoices?${qs}`, { headers: H });
    if (r.status === 429) throw new Error('rate_limit: حصة زوهو');
    const j = await r.json();
    if (j.code !== 0) throw new Error(`invoices: ${j.message || j.code}`);
    for (const i of (j.invoices || [])) {
      const st = String(i.status || '').toLowerCase();
      if (Number(i.balance) > 0.001 && st !== 'draft' && st !== 'void') {
        out.push({ invoice_id: i.invoice_id, number: i.invoice_number, date: i.date, balance: Number(i.balance) });
      }
    }
    if (!j.page_context?.has_more_page) break;
  }
  return out;
}

// يخصّص الأرصدة الدائنة على الفواتير (الأقدم أولاً) — منطق مشترك بين المرآة والحيّ.
// invoices: [{invoice_id, number, date, balance}] · creditNotes/excessPays: [{..., avail}]
function allocate(invoices: any[], creditNotes: any[], excessPays: any[]) {
  const creditAvailable = r2(
    creditNotes.reduce((s: number, c: any) => s + c.avail, 0) +
    excessPays.reduce((s: number, p: any) => s + p.avail, 0),
  );
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
    open_invoices: invoices,
    creditnote_apps: [...cnApps.entries()].map(([id, v]) => ({ creditnote_id: id, ...v })),
    payment_apps: [...payApps.entries()].map(([id, v]) => ({ payment_id: id, ...v })),
  };
}

// خطة من المرآة المحلية (بلا استدعاء زوهو حيّ) — الأساس السريع الموفّر للحصة.
// يرجع null إن لم تتوفّر بيانات المرآة (اسم غير موجود/فواتير فارغة) فيسقط
// المتصل تلقائياً للحيّ (احتمال عدم تطابق الاسم أو مرآة لم تُزامَن بعد).
async function buildPlanFromMirror(db: ReturnType<typeof svc>, contactId: string) {
  const { data: contact } = await db.from('zoho_contacts').select('contact_name').eq('zoho_id', contactId).maybeSingle();
  const name = contact?.contact_name;
  if (!name) return null;
  const [invR, cnR, payR] = await Promise.all([
    db.from('zoho_invoices').select('zoho_id, invoice_number, date, balance').eq('customer_name', name).gt('balance', 0.5).order('date', { ascending: true }),
    db.from('zoho_creditnotes').select('zoho_id, creditnote_number, balance').eq('customer_name', name).gt('balance', 0.5),
    db.from('zoho_payments').select('zoho_id, unused_amount').eq('customer_name', name).gt('unused_amount', 0.5),
  ]);
  const invoices = (invR.data || []).map((i: any) => ({ invoice_id: i.zoho_id, number: i.invoice_number, date: i.date, balance: Number(i.balance) }));
  if (!invoices.length) return null;   // مرآة فارغة → للحيّ (لا نطبّق بلا فواتير مؤكدة)
  const creditNotes = (cnR.data || []).map((c: any) => ({ creditnote_id: c.zoho_id, number: c.creditnote_number, avail: Number(c.balance) }));
  const excessPays = (payR.data || []).map((p: any) => ({ payment_id: p.zoho_id, ref: p.zoho_id, avail: Number(p.unused_amount) }));
  return { ...allocate(invoices, creditNotes, excessPays), source: 'mirror' };
}

// خطة حيّة من زوهو (fallback عند فراغ المرآة) — نفس منطق v3..v10.
async function buildPlanLive(token: string, apiDomain: string, orgId: string, contactId: string) {
  const H = { Authorization: `Zoho-oauthtoken ${token}` };
  const qs = (o: Record<string, string>) => new URLSearchParams({ organization_id: orgId, ...o }).toString();
  const [invoices, cnRes, payRes] = await Promise.all([
    fetchOpenInvoices(token, apiDomain, orgId, contactId),
    zfetch(`${apiDomain}/books/v3/creditnotes?${qs({ customer_id: contactId, status: 'open', per_page: '200' })}`, { headers: H }),
    zfetch(`${apiDomain}/books/v3/customerpayments?${qs({ customer_id: contactId, per_page: '200' })}`, { headers: H }),
  ]);
  const [cnJ, payJ] = await Promise.all([cnRes.json(), payRes.json()]);
  const creditNotes = (cnJ.code === 0 ? (cnJ.creditnotes || []) : [])
    .map((c: any) => ({ creditnote_id: c.creditnote_id, number: c.creditnote_number, avail: Number(c.balance) }))
    .filter((c: any) => c.avail > 0.001);
  const excessPays = (payJ.code === 0 ? (payJ.customerpayments || []) : [])
    .map((p: any) => ({ payment_id: p.payment_id, ref: p.reference_number || p.payment_number, avail: Number(p.unused_amount) }))
    .filter((p: any) => p.avail > 0.001);
  return { ...allocate(invoices, creditNotes, excessPays), source: 'live' };
}

// كاش خطة قصير (best-effort). المصدر: المرآة أولاً (صفر استدعاء زوهو) ثم الحيّ
// عند فراغها. capAlloc + getFresh (في apply) يحميان من تقادم أرصدة المرآة.
const planCache = new Map<string, { result: any; ts: number }>();
const PLAN_TTL = 90_000;
async function getPlan(db: ReturnType<typeof svc>, token: string, apiDomain: string, orgId: string, contactId: string) {
  const c = planCache.get(contactId);
  if (c && Date.now() - c.ts < PLAN_TTL) return c.result;
  let result = await buildPlanFromMirror(db, contactId).catch(() => null);
  if (!result) result = await buildPlanLive(token, apiDomain, orgId, contactId);
  planCache.set(contactId, { result, ts: Date.now() });
  return result;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const db = svc();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* */ }
  const action = String(body.action || '');
  const contactId = String(body.contact_id || '');
  const idempotencyKey = String(body.idempotency_key || '').trim();

  const auth = await requireUser(req, db);
  if (!auth) return json({ error: 'unauthorized — سجّل دخولك' }, 401);
  const isAdmin = auth.role === 'admin';
  const canRead = isAdmin || auth.permissions?.['money.pnl'] === true || auth.permissions?.['receivables.view'] === true;
  if (!canRead) return json({ error: 'forbidden' }, 403);
  // صلاحيات v2: «التطبيق» كتابة مالية في زوهو — مفتاح حسّاس مستقل عن مفاتيح
  // العرض (كان receivables.view وحده يكفي للكتابة!). plan/العرض يبقيان للقرّاء.
  if (action === 'apply' && !isAdmin && auth.permissions?.['zoho.apply_credits'] !== true) {
    return json({ error: 'forbidden — تحتاج صلاحية «تطبيق أرصدة دائنة»' }, 403);
  }
  if (!contactId) return json({ error: 'contact_id مطلوب' }, 400);
  if (action === 'apply' && !/^[A-Za-z0-9:_-]{16,200}$/.test(idempotencyKey)) {
    return json({ error: 'idempotency_key صالح مطلوب لتنفيذ العملية' }, 400);
  }

  let operationId: number | null = null;
  let operationApplied = 0;
  try {
    const { token, apiDomain, orgId } = await accessToken(db);

    if (action === 'plan') {
      const result = await getPlan(db, token, apiDomain, orgId, contactId);
      return json({ ok: true, ...result });
    }

    if (action === 'apply') {
      if (!isAdmin) return json({ error: 'forbidden — التطبيق للمدير فقط' }, 403);
      const claim = await claimWriteOperation(db, {
        idempotencyKey,
        action: 'apply_credits',
        contactId,
        requestedBy: auth.user.id,
        payload: { contact_id: contactId },
      });
      if (!claim.claimed) {
        const prior = claim.prior as Record<string, any>;
        if (prior.status === 'succeeded' || prior.status === 'partial') {
          return json({ ...(prior.result_payload || {}), duplicate: true, operation_status: prior.status });
        }
        return json({
          ok: false,
          duplicate: true,
          operation_status: prior.status,
          error: prior.status === 'running'
            ? 'العملية نفسها قيد التنفيذ الآن'
            : 'هذه العملية مسجلة بنتيجة غير مؤكدة؛ راجع زوهو قبل إعادة التنفيذ',
        }, prior.status === 'running' ? 409 : 200);
      }
      operationId = claim.id;
      const complete = async (payload: Record<string, unknown>, status: 'succeeded' | 'partial' | 'failed') => {
        const applied = Number(payload.applied) || 0;
        operationApplied = applied;
        await finishWriteOperation(db, operationId!, status, payload, applied,
          status === 'succeeded' ? null : String(payload.error || 'نتيجة جزئية'));
        return json(payload);
      };
      const result = await getPlan(db, token, apiDomain, orgId, contactId);
      planCache.delete(contactId);   // الأرصدة ستتغيّر بالكتابة — أبطِل الكاش
      if (!result.plan.length) return await complete({ ok: true, applied: 0, results: [], note: 'لا شيء للتطبيق' }, 'succeeded');

      const H = { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' };
      const results: any[] = [];
      let appliedTotal = 0;

      // الأرصدة الحيّة للفواتير المفتوحة — من نتيجة buildPlan نفسها (بلا جلب
      // ثانٍ، لتقليل استهلاك حصة زوهو). نقيّد كل تطبيق بها لتفادي رفض «المبلغ
      // أكثر من الرصيد المستحق» (حدود التقريب + تغيّر الرصيد بعد الإشعارات).
      const liveBal = new Map<string, number>();
      for (const i of (result.open_invoices || [])) liveBal.set(i.invoice_id, i.balance);

      // يقصّ قائمة تطبيقات على الرصيد الحيّ، ويُنقص المتبقّي. يرجع القائمة المقصوصة ومجموعها.
      const capAlloc = (invs: any[]) => {
        const list: any[] = []; let sum = 0;
        for (const x of invs) {
          const live = liveBal.has(x.invoice_id) ? liveBal.get(x.invoice_id)! : Number(x.amount_applied);
          const amt = r2(Math.min(Number(x.amount_applied), live));
          if (amt > 0.001) { list.push({ invoice_id: x.invoice_id, amount_applied: amt }); sum = r2(sum + amt); liveBal.set(x.invoice_id, r2(live - amt)); }
        }
        return { list, sum };
      };
      // يعيد الرصيد المقتطع عند فشل التطبيق (حتى يستفيد منه مصدر لاحق)
      const refund = (list: any[]) => { for (const x of list) liveBal.set(x.invoice_id, r2((liveBal.get(x.invoice_id) || 0) + x.amount_applied)); };

      // جلب طازج للأرصدة (مرة واحدة، memoized) — يُستدعى فقط عند رفض «أكثر من
      // الرصيد» لإعادة القصّ على الحقيقة الحيّة (يعالج سباق Deluce/تقادم الكاش).
      let freshBal: Map<string, number> | null = null;
      const getFresh = async () => {
        if (!freshBal) {
          const inv = await fetchOpenInvoices(token, apiDomain, orgId, contactId);
          freshBal = new Map(inv.map((i: any) => [i.invoice_id, i.balance]));
        }
        return freshBal;
      };
      // يقصّ قائمة على خريطة أرصدة معيّنة (يُنقصها) — للمحاولة الثانية بالأرصدة الطازجة.
      const capOn = (bal: Map<string, number>, invs: any[]) => {
        const list: any[] = []; let sum = 0;
        for (const x of invs) {
          const b = bal.has(x.invoice_id) ? bal.get(x.invoice_id)! : 0;
          const amt = r2(Math.min(Number(x.amount_applied), b));
          if (amt > 0.001) { list.push({ invoice_id: x.invoice_id, amount_applied: amt }); sum = r2(sum + amt); bal.set(x.invoice_id, r2(b - amt)); }
        }
        return { list, sum };
      };

      // 1) الإشعارات الدائنة → POST /creditnotes/{id}/invoices (إضافي، آمن)
      for (const app of result.creditnote_apps) {
        try {
          const doPost = async (nl: any[]) => {
            const r = await zfetch(`${apiDomain}/books/v3/creditnotes/${app.creditnote_id}/invoices?organization_id=${orgId}`, {
              method: 'POST', headers: H, body: JSON.stringify({ invoices: nl }),
            });
            const j = await r.json().catch(() => ({}));
            return { r, ok: j.code === 0, err: j.code === 0 ? null : (j.message || `code ${j.code}`) };
          };
          let { list, sum } = capAlloc(app.invoices);
          if (!list.length) { results.push({ source: `إشعار ${app.number}`, applied: 0, ok: true }); continue; }
          let res1 = await doPost(list);

          // أي فشل غير الصلاحية/الحصة → أعِد الجلب الطازج وأعد القصّ ومرّة أخيرة
          if (!res1.ok && !authErr(res1.err) && !rateLimited(res1.err) && res1.r.status !== 429) {
            console.error('[apply cn fail#1]', JSON.stringify({ cn: app.creditnote_id, num: app.number, tried: list, err: res1.err }));
            refund(list);
            const fresh = await getFresh();
            const recap = capOn(fresh, app.invoices);
            list = recap.list; sum = recap.sum;
            if (!list.length) { results.push({ source: `إشعار ${app.number}`, applied: 0, ok: true, note: 'لا رصيد متبقٍّ' }); continue; }
            res1 = await doPost(list);
            if (!res1.ok) console.error('[apply cn fail#2]', JSON.stringify({ cn: app.creditnote_id, tried: list, err: res1.err }));
          }

          const ok = res1.ok;
          if (ok) appliedTotal = r2(appliedTotal + sum); else refund(list);
          operationApplied = appliedTotal;
          results.push({ source: `إشعار ${app.number}`, applied: ok ? sum : 0, ok, error: res1.err });
          if (!ok && (res1.r.status === 429 || rateLimited(res1.err))) return await complete({ ok: true, applied: appliedTotal, count: results.filter(x => x.ok).length, results, rate_limited: true }, 'partial');
          if (!ok && authErr(res1.err)) return await complete({ ok: true, applied: appliedTotal, count: results.filter(x => x.ok).length, results, role_error: true }, 'partial');
        } catch (e) {
          results.push({ source: `إشعار ${app.number}`, applied: 0, ok: false, error: String((e as Error).message || e) });
        }
      }

      // 2) الدفعات الزائدة → PUT /customerpayments/{id} مع ضمّ التطبيقات القائمة
      //    (الجديد مُقيَّد بالرصيد الحيّ، والقائمة موحّدة بلا تكرار فاتورة)
      for (const app of result.payment_apps) {
        try {
          const existing = new Map<string, number>();
          try {
            const gp = await zfetch(`${apiDomain}/books/v3/customerpayments/${app.payment_id}?organization_id=${orgId}`, { headers: H });
            const gj = await gp.json();
            for (const x of (gj?.payment?.invoices || [])) existing.set(x.invoice_id, r2((existing.get(x.invoice_id) || 0) + Number(x.amount_applied)));
          } catch { /* لو فشل الجلب، نطبّق الجديد فقط */ }

          // ينفّذ PUT بقائمة جديدة مدموجة مع القائمة القائمة (بلا تكرار فاتورة)
          const doPut = async (nl: any[]) => {
            const m = new Map(existing);
            for (const x of nl) m.set(x.invoice_id, r2((m.get(x.invoice_id) || 0) + x.amount_applied));
            const merged = [...m].map(([invoice_id, amount_applied]) => ({ invoice_id, amount_applied }));
            const r = await zfetch(`${apiDomain}/books/v3/customerpayments/${app.payment_id}?organization_id=${orgId}`, {
              method: 'PUT', headers: H, body: JSON.stringify({ invoices: merged }),
            });
            const j = await r.json().catch(() => ({}));
            return { r, ok: j.code === 0, err: j.code === 0 ? null : (j.message || `code ${j.code}`) };
          };

          let { list: newList, sum } = capAlloc(app.invoices);
          if (!newList.length) { results.push({ source: `دفعة ${app.ref}`, applied: 0, ok: true }); continue; }
          let res2 = await doPut(newList);

          // أي فشل غير الصلاحية/الحصة → رصيدنا المرجعي غالباً قديم؛ أعِد جلب
          // الرصيد والتطبيقات القائمة الطازجة، أعد القصّ، وحاول مرة أخيرة.
          if (!res2.ok && !authErr(res2.err) && !rateLimited(res2.err) && res2.r.status !== 429) {
            console.error('[apply pay fail#1]', JSON.stringify({ pay: app.payment_id, ref: app.ref, tried: newList, err: res2.err }));
            refund(newList);
            try {
              const gp2 = await zfetch(`${apiDomain}/books/v3/customerpayments/${app.payment_id}?organization_id=${orgId}`, { headers: H });
              const gj2 = await gp2.json();
              existing.clear();
              for (const x of (gj2?.payment?.invoices || [])) existing.set(x.invoice_id, r2((existing.get(x.invoice_id) || 0) + Number(x.amount_applied)));
            } catch { /* أبقِ القائمة القديمة */ }
            const fresh = await getFresh();
            const recap = capOn(fresh, app.invoices);
            newList = recap.list; sum = recap.sum;
            if (!newList.length) { results.push({ source: `دفعة ${app.ref}`, applied: 0, ok: true, note: 'لا رصيد متبقٍّ' }); continue; }
            res2 = await doPut(newList);
            if (!res2.ok) console.error('[apply pay fail#2]', JSON.stringify({ pay: app.payment_id, tried: newList, existing: [...existing], err: res2.err }));
          }

          const ok = res2.ok;
          if (ok) appliedTotal = r2(appliedTotal + sum); else refund(newList);
          operationApplied = appliedTotal;
          results.push({ source: `دفعة ${app.ref}`, applied: ok ? sum : 0, ok, error: res2.err });
          if (!ok && (res2.r.status === 429 || rateLimited(res2.err))) return await complete({ ok: true, applied: appliedTotal, count: results.filter(x => x.ok).length, results, rate_limited: true }, 'partial');
          if (!ok && authErr(res2.err)) return await complete({ ok: true, applied: appliedTotal, count: results.filter(x => x.ok).length, results, role_error: true }, 'partial');
        } catch (e) {
          results.push({ source: `دفعة ${app.ref}`, applied: 0, ok: false, error: String((e as Error).message || e) });
        }
      }

      const payload = { ok: true, applied: appliedTotal, count: results.filter(x => x.ok).length, results };
      return await complete(payload, results.some(x => !x.ok) ? 'partial' : 'succeeded');
    }

    return json({ error: 'action غير معروف (plan | apply)' }, 400);
  } catch (e) {
    const msg = String((e as Error).message || e);
    if (operationId) {
      try {
        await finishWriteOperation(db, operationId, 'unknown', { ok: false, error: msg }, operationApplied, msg);
      } catch (auditError) {
        console.error('[zoho-apply-credits] failed to persist operation failure', auditError);
      }
    }
    // تجاوز حصة زوهو → رسالة ودّية (200) بدل 500 حتى تعرضها الواجهة بوضوح.
    if (rateLimited(msg)) return json({ ok: false, rate_limited: true, error: 'حصة زوهو ممتلئة مؤقتاً (~100 طلب/دقيقة). انتظر دقيقة وأعد المحاولة.' });
    return json({ error: msg }, 500);
  }
});

