// zoho-sync v5 — + pnl_month: جلب قائمة دخل شهر من زوهو، تحليلها لأرقام
// موحّدة (income/cogs/opex/net + lines)، وتخزينها في pnl_snapshots (كاش).
// التحليل بمطابقة الأسماء (عربي + إنجليزي fallback) — لا مواقع ثابتة.
//
// النشر عبر MCP (deploy_edge_function) — هذا الملف نسخة الريبو المرجعية؛
// أي تعديل هنا يجب أن يُنشر أيضاً.

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const REDIRECT_URI = 'https://shipaudit-five.vercel.app/zoho-callback';
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const supa = () => createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

async function accessToken(db: ReturnType<typeof supa>) {
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

async function saveGrant(db: ReturnType<typeof supa>, j: Record<string, unknown>, dc: string) {
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

// مطابقة أسماء أقسام قائمة الدخل (زوهو يُرجعها بلغة المؤسسة)
const SEC = {
  income:        [/الدخل التشغيلي/, /operating income/i],
  cogs:          [/تكلفة السلع/, /cost of goods/i],
  opex:          [/المصروفات التشغيلية/, /operating expense/i],
  other_income:  [/الدخل غير التشغيلي/, /non.?operating income/i],
  other_expense: [/المصروفات غير التشغيلية/, /non.?operating expense/i],
};
type Sec = { name?: string; total?: number; total_label?: string; account_transactions?: Sec[] };
function parsePnl(pl: Sec[]) {
  const out: Record<string, number> = { income: 0, cogs: 0, opex: 0, other_income: 0, other_expense: 0 };
  const lines: { group: string; accounts: { name: string; total: number }[] }[] = [];
  const walk = (secs: Sec[]) => {
    for (const s of secs || []) {
      const nm = s.name || '';
      for (const [key, pats] of Object.entries(SEC)) {
        if (pats.some(p => p.test(nm))) {
          out[key] = Number(s.total) || 0;
          lines.push({
            group: nm,
            accounts: (s.account_transactions || [])
              .filter(a => a.name)
              .map(a => ({ name: a.name!, total: Number(a.total) || 0 })),
          });
        }
      }
      if (s.account_transactions?.length) walk(s.account_transactions);
    }
  };
  walk(pl);
  // الصافي = آخر قسم علوي (صافي الأرباح/الخسائر) — وإن غاب نحسبه
  const lastTop = Array.isArray(pl) && pl.length ? Number(pl[pl.length - 1]?.total) : NaN;
  const computed = out.income - out.cogs - out.opex + out.other_income - out.other_expense;
  const net = Number.isFinite(lastTop) ? lastTop : +computed.toFixed(2);
  return { ...out, net, lines, computed_net: +computed.toFixed(2) };
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
  const db = supa();

  try {
    if (action === 'exchange_web') {
      const id = Deno.env.get('ZOHO_CLIENT_ID');
      const secret = Deno.env.get('ZOHO_CLIENT_SECRET');
      const code = body.code as string;
      if (!id || !secret) return json({ error: 'missing_secrets' }, 400);
      if (!code) return json({ error: 'missing_code' }, 400);
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
      const { token, apiDomain, orgId } = await accessToken(db);
      const period = body.period as string | undefined;             // 'YYYY-MM' لـpnl_month
      const from = (body.from as string) || (period ? `${period}-01` : null);
      const to = (body.to as string) || (period ? lastDay(period) : null);
      if (!from || !to) return json({ error: 'missing from/to أو period' }, 400);
      const qs = new URLSearchParams({ organization_id: orgId, from_date: from, to_date: to, cash_based: 'false' });
      const r = await fetch(`${apiDomain}/books/v3/reports/profitandloss?${qs}`, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      });
      const j = await r.json();
      if (j.code !== 0) return json({ error: `zoho: ${j.message || JSON.stringify(j)}`, code: j.code }, 400);
      if (action === 'pnl') return json({ ok: true, from, to, profit_and_loss: j.profit_and_loss ?? j });
      // pnl_month: حلّل + خزّن في الكاش
      const parsed = parsePnl(j.profit_and_loss || []);
      const row = {
        period,
        income: parsed.income, cogs: parsed.cogs, opex: parsed.opex,
        other_income: parsed.other_income, other_expense: parsed.other_expense,
        net: parsed.net, lines: parsed.lines,
        fetched_at: new Date().toISOString(),
      };
      const { error } = await db.from('pnl_snapshots').upsert(row);   // PK كامل — لا فخّ 42P10
      if (error) return json({ error: `save failed: ${error.message}` }, 500);
      return json({ ok: true, snapshot: row, computed_net: parsed.computed_net });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
