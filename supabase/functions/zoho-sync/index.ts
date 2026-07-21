// zoho-sync v14 — مصالحة الدفعات ذات الرصيد المفتوح: تطبيق الدفعة على فاتورة
// لا يُحرّك last_modified لها (نفس فخّ الإشعارات §1.26b) فتبقى «غير مستخدمة»
// وهمياً في المرآة (دفعة 12,197 لعميل OUT OF LINE بقيت عالقة 3 أيام).
// العلاج: إعادة جلب موجّهة لكل دفعة unused>0 عندنا (قائمة صغيرة، سقف 40/دورة).
// v13 — الإشعارات الدائنة: سحب كامل (noDelta) + مصالحة الحذف — تطبيق/حذف
// الإشعار في زوهو لا يُحرّك last_modified، فالدلتا وupsert يتركانه عالقاً برصيد وهمي.
// v12 — + كيان creditnotes (مرآة الإشعارات الدائنة) + unused_amount
// للدفعات — أساس بناء «خطة تطبيق الرصيد» من المرآة بلا استدعاء زوهو حيّ.
// v11 — + كيان contacts (أرصدة العملاء/الموردين المباشرة شاملة
// السلف والإشعارات الدائنة — تُغني عن ملف «أرصدة الموردين» الإيميلي).
// v10 — expenses: فرز date + سحب كامل (زوهو لا يدعم فرز
// last_modified_time لهذه القائمة). v9: هوية آلية pg_cron (X-Cron-Key).
// v8: sync شامل 6 كيانات. v6/v7: مصادقة داخلية + TTL + محلّل + CORS.

import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_ORIGIN = 'https://shipaudit-five.vercel.app';
const CORS = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const REDIRECT_URI = `${APP_ORIGIN}/zoho-callback`;
const PNL_TTL_MS = 10 * 60_000;
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

async function saveGrant(db: ReturnType<typeof svc>, j: Record<string, unknown>, dc: string) {
  const apiDomain = (j.api_domain as string) || `https://www.zohoapis.${dc}`;
  let orgId: string | null = null, orgName: string | null = null;
  try {
    const or = await fetch(`${apiDomain}/books/v3/organizations`, {
      headers: { Authorization: `Zoho-oauthtoken ${j.access_token}` },
    });
    const oj = await or.json();
    orgId = oj?.organizations?.[0]?.organization_id ?? null;
    orgName = oj?.organizations?.[0]?.name ?? null;
  } catch { /* اختياري */ }
  const { error } = await db.from('zoho_auth').upsert({
    id: 1, refresh_token: j.refresh_token,
    accounts_domain: `accounts.zoho.${dc}`, api_domain: apiDomain,
    org_id: orgId, updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`save failed: ${error.message}`);
  return { orgId, orgName, dc };
}

const SEC_ORDERED: [string, RegExp[]][] = [
  ['other_income',  [/الدخل غير التشغيلي/, /non.?operating income/i]],
  ['other_expense', [/المصروفات غير التشغيلية/, /non.?operating expense/i]],
  ['income',        [/الدخل التشغيلي/, /operating income/i]],
  ['cogs',          [/تكلفة السلع/, /cost of goods/i]],
  ['opex',          [/المصروفات التشغيلية/, /operating expense/i]],
];
const NET_PATTERNS = [/صافي الأرباح/, /صافي الربح/, /net profit/i, /net income/i];
type Sec = { name?: string; total?: number; total_label?: string; account_transactions?: Sec[] };
function parsePnl(pl: Sec[]) {
  const out: Record<string, number> = { income: 0, cogs: 0, opex: 0, other_income: 0, other_expense: 0 };
  const seen = new Set<string>();
  const lines: { group: string; accounts: { name: string; total: number }[] }[] = [];
  let namedNet: number | null = null;

  const matchKey = (nm: string): string | null => {
    for (const [key, pats] of SEC_ORDERED) {
      if (pats.some(p => p.test(nm))) return key;
    }
    return null;
  };
  const walk = (secs: Sec[], depth: number) => {
    for (const s of secs || []) {
      const nm = s.name || '';
      if (namedNet == null && NET_PATTERNS.some(p => p.test(nm))) {
        const v = Number(s.total);
        if (Number.isFinite(v)) namedNet = v;
      }
      const key = depth <= 1 ? matchKey(nm) : null;
      if (key && !seen.has(key)) {
        seen.add(key);
        out[key] = Number(s.total) || 0;
        lines.push({
          group: nm,
          accounts: (s.account_transactions || [])
            .filter(a => a.name)
            .map(a => ({ name: a.name!, total: Number(a.total) || 0 })),
        });
        continue;
      }
      if (s.account_transactions?.length && depth < 2) walk(s.account_transactions, depth + 1);
    }
  };
  walk(pl, 0);
  const computed = +(out.income - out.cogs - out.opex + out.other_income - out.other_expense).toFixed(2);
  const net = (namedNet != null && Math.abs(namedNet - computed) <= 0.05) ? namedNet : computed;
  return { ...out, net, lines, computed_net: computed };
}

const lastDay = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return `${period}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* بلا جسم */ }
  const action = (body.action as string) || url.searchParams.get('action') || 'status';
  const db = svc();

  try {
    let auth: Awaited<ReturnType<typeof requireUser>> = null;
    const cronKey = req.headers.get('X-Cron-Key') || req.headers.get('x-cron-key');
    if (cronKey && (action === 'sync' || action === 'pnl_month')) {
      const { data: za } = await db.from('zoho_auth').select('cron_key').eq('id', 1).maybeSingle();
      if (za?.cron_key && za.cron_key === cronKey) {
        auth = { user: null as never, role: 'admin', permissions: {} };
      }
    }
    if (!auth) auth = await requireUser(req, db);
    if (!auth) return json({ error: 'unauthorized — سجّل دخولك' }, 401);

    if (action === 'exchange_web') {
      if (auth.role !== 'admin') return json({ error: 'forbidden — الربط للمدير فقط' }, 403);
      const id = Deno.env.get('ZOHO_CLIENT_ID');
      const secret = Deno.env.get('ZOHO_CLIENT_SECRET');
      const code = body.code as string;
      if (!id || !secret) return json({ error: 'missing_secrets' }, 400);
      if (!code) return json({ error: 'missing_code' }, 400);
      const { data: existing } = await db.from('zoho_auth').select('refresh_token, org_id').eq('id', 1).maybeSingle();
      if (existing?.refresh_token && body.force !== true) {
        return json({ error: 'already_connected — الربط قائم؛ أعد الربط بـforce:true إن كنت تقصد استبداله', org_id: existing.org_id }, 409);
      }
      const errors: Record<string, string> = {};
      for (const dc of ['sa', 'com', 'eu', 'in']) {
        try {
          const r = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code', client_id: id, client_secret: secret,
              redirect_uri: REDIRECT_URI, code,
            }),
          });
          const j = await r.json();
          if (j.refresh_token) return json({ ok: true, ...(await saveGrant(db, j, dc)) });
          errors[dc] = (j.error as string) || JSON.stringify(j);
        } catch (e) { errors[dc] = String(e); }
      }
      return json({ error: 'exchange_failed', details: errors }, 400);
    }

    if (!canPnl(auth)) return json({ error: 'forbidden — تحتاج صلاحية «الوضع المالي»' }, 403);

    if (action === 'status') {
      const { data } = await db.from('zoho_auth')
        .select('accounts_domain, api_domain, org_id, updated_at').eq('id', 1).maybeSingle();
      return json({ connected: !!data?.accounts_domain, ...(data || {}) });
    }

    if (action === 'test') {
      const { token, apiDomain } = await accessToken(db);
      const or = await fetch(`${apiDomain}/books/v3/organizations`, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      });
      const oj = await or.json();
      return json({ ok: true, organizations: (oj.organizations || []).map((o: Record<string, unknown>) => ({ id: o.organization_id, name: o.name, currency: o.currency_code })) });
    }

    if (action === 'pnl' || action === 'pnl_month') {
      let from: string, to: string, period: string | undefined;
      if (action === 'pnl_month') {
        period = body.period as string;
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period || '')) return json({ error: 'bad period — YYYY-MM' }, 400);
        from = `${period}-01`; to = lastDay(period!);
        const { data: cached } = await db.from('pnl_snapshots').select('*').eq('period', period).maybeSingle();
        if (cached && Date.now() - new Date(cached.fetched_at).getTime() < PNL_TTL_MS) {
          return json({ ok: true, snapshot: cached, cached: true });
        }
      } else {
        from = body.from as string; to = body.to as string;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) {
          return json({ error: 'bad from/to — YYYY-MM-DD' }, 400);
        }
      }
      const { token, apiDomain, orgId } = await accessToken(db);
      const qs = new URLSearchParams({ organization_id: orgId, from_date: from, to_date: to, cash_based: 'false' });
      const r = await fetch(`${apiDomain}/books/v3/reports/profitandloss?${qs}`, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      });
      const j = await r.json();
      if (j.code !== 0) return json({ error: `zoho: ${j.message || JSON.stringify(j)}`, code: j.code }, 400);
      if (action === 'pnl') return json({ ok: true, from, to, profit_and_loss: j.profit_and_loss ?? j });
      const parsed = parsePnl(j.profit_and_loss || []);
      const row = {
        period,
        income: parsed.income, cogs: parsed.cogs, opex: parsed.opex,
        other_income: parsed.other_income, other_expense: parsed.other_expense,
        net: parsed.net, lines: parsed.lines,
        fetched_at: new Date().toISOString(),
      };
      const { error } = await db.from('pnl_snapshots').upsert(row);
      if (error) return json({ error: `save failed: ${error.message}` }, 500);
      return json({ ok: true, snapshot: row, computed_net: parsed.computed_net });
    }

    if (action === 'sync') {
      const { token, apiDomain, orgId } = await accessToken(db);
      const ENTITIES: { ent: string; listKey: string; table: string;
        sortColumn?: string; noDelta?: boolean; reconcileDeletes?: boolean;
        map: (it: Record<string, unknown>, lmIso: string | null, now: string) => Record<string, unknown> }[] = [
        { ent: 'invoices', listKey: 'invoices', table: 'zoho_invoices', map: (it, lm, now) => ({
          zoho_id: it.invoice_id, invoice_number: it.invoice_number, customer_name: it.customer_name,
          date: it.date || null, total: Number(it.total) || 0, balance: Number(it.balance) || 0,
          status: it.status || null, last_modified: lm, synced_at: now,
          einvoice_status: (it.einvoice_status as string) || null }) },
        { ent: 'customerpayments', listKey: 'customerpayments', table: 'zoho_payments', map: (it, lm, now) => ({
          zoho_id: it.payment_id, customer_name: it.customer_name, date: it.date || null,
          amount: Number(it.amount) || 0, unused_amount: Number(it.unused_amount) || 0, mode: it.payment_mode || null,
          invoice_numbers: (it.invoice_numbers as string) || '', last_modified: lm, synced_at: now }) },
        // الإشعارات الدائنة — مرآة. **سحب كامل (noDelta) + مصالحة الحذف**:
        // تطبيق الإشعار على فاتورة (POST …/invoices) لا يُحرّك last_modified_time،
        // والحذف/الإلغاء يُخرجه من القائمة — فالدلتا وupsert يتركانه عالقاً
        // برصيد وهمي (CN-00029 بقي open/1000 وقد حُذف). full + reconcile يصحّح.
        { ent: 'creditnotes', listKey: 'creditnotes', table: 'zoho_creditnotes', noDelta: true, reconcileDeletes: true, map: (it, lm, now) => ({
          zoho_id: it.creditnote_id, creditnote_number: it.creditnote_number, customer_name: it.customer_name,
          date: it.date || null, total: Number(it.total) || 0, balance: Number(it.balance) || 0,
          status: it.status || null, last_modified: lm, synced_at: now }) },
        // expenses: زوهو لا يدعم فرز last_modified_time لهذه القائمة → فرز
        // date + سحب كامل بلا early-stop — upsert يمتص التكرار.
        { ent: 'expenses', listKey: 'expenses', table: 'zoho_expenses', sortColumn: 'date', noDelta: true,
          map: (it, lm, now) => ({
          zoho_id: it.expense_id, date: it.date || null,
          account_name: it.account_name || null, vendor_name: it.vendor_name || null,
          total: Number(it.total) || 0, status: it.status || null,
          description: (it.description as string) || null,
          reference_number: (it.reference_number as string) || null, last_modified: lm, synced_at: now }) },
        { ent: 'bills', listKey: 'bills', table: 'zoho_bills', map: (it, lm, now) => ({
          zoho_id: it.bill_id, bill_number: it.bill_number || null, vendor_name: it.vendor_name || null,
          date: it.date || null, due_date: it.due_date || null,
          total: Number(it.total) || 0, balance: Number(it.balance) || 0,
          status: it.status || null, last_modified: lm, synced_at: now }) },
        { ent: 'vendorpayments', listKey: 'vendorpayments', table: 'zoho_vendor_payments', map: (it, lm, now) => ({
          zoho_id: it.payment_id, vendor_name: it.vendor_name || null, date: it.date || null,
          amount: Number(it.amount) || 0, mode: it.payment_mode || null,
          reference_number: (it.reference_number as string) || null, last_modified: lm, synced_at: now }) },
        { ent: 'journals', listKey: 'journals', table: 'zoho_journals', map: (it, lm, now) => ({
          zoho_id: it.journal_id, entry_number: (it.entry_number as string) || null,
          reference_number: (it.reference_number as string) || null,
          date: it.journal_date || it.date || null,
          notes: (it.notes as string) || null, total: Number(it.total) || 0,
          status: (it.status as string) || null, last_modified: lm, synced_at: now }) },
        // contacts (v11): الرصيد المستحق لكل عميل/مورد مباشرة من زوهو —
        // يشمل السلف والإشعارات الدائنة (unused_credits). سحب كامل بلا دلتا.
        { ent: 'contacts', listKey: 'contacts', table: 'zoho_contacts', sortColumn: 'contact_name', noDelta: true,
          map: (it, lm, now) => ({
          zoho_id: it.contact_id, contact_name: (it.contact_name as string) || null,
          contact_type: (it.contact_type as string) || null,
          outstanding_receivable: Number(it.outstanding_receivable_amount) || 0,
          outstanding_payable: Number(it.outstanding_payable_amount) || 0,
          unused_credits_receivable: Number(it.unused_credits_receivable_amount) || 0,
          unused_credits_payable: Number(it.unused_credits_payable_amount) || 0,
          status: (it.status as string) || null, last_modified: lm, synced_at: now }) },
      ];
      const results: Record<string, number | string> = {};
      for (const cfg of ENTITIES) {
        try {
          const { data: st } = await db.from('zoho_sync_state').select('last_sync').eq('entity', cfg.ent).maybeSingle();
          const since = cfg.noDelta ? null : (st?.last_sync ? new Date(st.last_sync).getTime() : null);
          const runStart = new Date().toISOString();
          let page = 1, saved = 0, more = true, entErr: string | null = null;
          while (more && page <= 25) {
            const qs = new URLSearchParams({
              organization_id: orgId, per_page: '200', page: String(page),
              sort_column: cfg.sortColumn || 'last_modified_time', sort_order: 'D',
            });
            const r = await fetch(`${apiDomain}/books/v3/${cfg.ent}?${qs}`, {
              headers: { Authorization: `Zoho-oauthtoken ${token}` },
            });
            const j = await r.json();
            if (j.code !== 0) { entErr = j.message || `code ${j.code}`; break; }
            const rows: Record<string, unknown>[] = j[cfg.listKey] || [];
            let reachedOld = false;
            const now = new Date().toISOString();
            const mapped: Record<string, unknown>[] = [];
            for (const it of rows) {
              const lmMs = it.last_modified_time ? new Date(it.last_modified_time as string).getTime() : null;
              if (since && lmMs && lmMs <= since) { reachedOld = true; break; }
              const row = cfg.map(it, lmMs ? new Date(lmMs).toISOString() : null, now);
              if (row.zoho_id) mapped.push(row);
            }
            if (mapped.length) {
              const { error } = await db.from(cfg.table).upsert(mapped);
              if (error) { entErr = `save: ${error.message}`; break; }
              saved += mapped.length;
            }
            more = !reachedOld && !!(j.page_context?.has_more_page);
            page++;
          }
          if (entErr) { results[cfg.ent] = `خطأ: ${entErr}`; continue; }
          // مصالحة الحذف: المزامنة upsert فقط فلا تلتقط ما حُذف/أُلغي في زوهو (يبقى
          // عالقاً برصيد وهمي). آمنة حصراً لكيان كامل (noDelta) اكتمل سحبه (more=false؛
          // لم يُقصّ بحدّ الصفحات). أحذف ما لم يُلمَس هذه الدورة (synced_at قبل البداية).
          if (cfg.reconcileDeletes && !more) {
            await db.from(cfg.table).delete().lt('synced_at', runStart);
          }
          await db.from('zoho_sync_state').upsert({
            entity: cfg.ent, last_sync: new Date().toISOString(), last_count: saved, updated_at: new Date().toISOString(),
          });
          results[cfg.ent] = saved;
        } catch (e) { results[cfg.ent] = `خطأ: ${String((e as Error).message || e)}`; }
      }

      // v14: مصالحة الدفعات ذات الرصيد المفتوح — تطبيق الدفعة على فاتورة لا
      // يُحرّك last_modified لها (نفس فخّ الإشعارات) فتبقى «غير مستخدمة» وهمياً
      // وتُفشل «طبّق للكل» بـ«أكثر من الرصيد». القائمة صغيرة دائماً → إعادة جلب
      // موجّهة لكل دفعة unused>0 (سقف 40/دورة). 404 = حُذفت في زوهو → تُحذف عندنا.
      try {
        const { data: openPays } = await db.from('zoho_payments')
          .select('zoho_id').gt('unused_amount', 0.01).limit(40);
        let refreshed = 0;
        for (const p of openPays || []) {
          const r = await fetch(`${apiDomain}/books/v3/customerpayments/${p.zoho_id}?organization_id=${orgId}`, {
            headers: { Authorization: `Zoho-oauthtoken ${token}` },
          });
          const j = await r.json().catch(() => ({} as Record<string, unknown>));
          const pay = (j as Record<string, any>)?.payment;
          if ((j as Record<string, unknown>).code === 0 && pay) {
            await db.from('zoho_payments').update({
              amount: Number(pay.amount) || 0,
              unused_amount: Number(pay.unused_amount) || 0,
              invoice_numbers: Array.isArray(pay.invoices)
                ? pay.invoices.map((v: Record<string, unknown>) => v.invoice_number).filter(Boolean).join(', ')
                : '',
              last_modified: pay.last_modified_time ? new Date(pay.last_modified_time as string).toISOString() : null,
              synced_at: new Date().toISOString(),
            }).eq('zoho_id', p.zoho_id);
            refreshed++;
          } else if (r.status === 404) {
            await db.from('zoho_payments').delete().eq('zoho_id', p.zoho_id);
            refreshed++;
          }
          await new Promise(res => setTimeout(res, 120));
        }
        results['payments_refetch'] = refreshed;
      } catch (e) { results['payments_refetch'] = `خطأ: ${String((e as Error).message || e)}`; }

      return json({ ok: true, results });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
