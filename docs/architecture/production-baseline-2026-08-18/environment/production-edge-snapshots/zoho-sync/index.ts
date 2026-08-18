// zoho-sync v29 — مرآة محلية بجدولة متدرجة ومنع إعادة فحص الدفعات بلا تغيير.
// zoho-sync v28 — قراءة الرصيد الافتتاحي الموجهة حتى لو كان الرصيد الحالي صفراً.
// zoho-sync v27 — الرصيد الافتتاحي من مساره الرسمي المخصص في Zoho.
// v26 — الرصيد الافتتاحي الصريح + إصلاح فواتير العملاء الناقصة تلقائياً.
// لا يُسمّى فرق الرصيد «افتتاحياً» إلا إذا أثبته حقل opening_balances في Zoho.
// أي فرق غير مفسر يطلق جلباً موجهاً لكل فواتير العميل قبل أن يصل للشاشات والحملات.
// v25 — مصالحة أرصدة العملاء التفصيلية للحالات التي يظهر فيها فرق بلا فاتورة.
// قائمة جهات الاتصال قد تبقي رصيداً افتتاحياً مسدداً؛ بطاقة العميل التفصيلية هي المرجع النهائي.
// v24 — + تنزيل PDF الرسمي لفاتورة العميل ومرفق فاتورة المورد (قراءة فقط).
// v23 — رقابة مالية للقراءة + retry/429 + قياس الحصة + مزامنة البنوك والخزائن.
// v21 — سجل دائم لكل دورة + اكتمال pagination + معرّفات العملاء/الموردين.
// v14 — مصالحة الدفعات ذات الرصيد المفتوح: تطبيق الدفعة على فاتورة
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
import { beginSyncRun, finishSyncRun } from '../_shared/zohoReliability.ts';
import { verifyZohoOAuthState } from '../_shared/zohoOAuthState.ts';
import { fetchZohoJson, fetchZohoRaw, isZohoAuthorizationError, recordZohoUsage, type ZohoApiStats } from '../_shared/zohoClient.ts';

const APP_ORIGIN = 'https://shipaudit-five.vercel.app';
const CORS = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const REDIRECT_URI = `${APP_ORIGIN}/zoho-callback`;
const PNL_TTL_MS = 10 * 60_000;
const OAUTH_PENDING_TTL_MS = 10 * 60_000;
const PAYMENT_UNUSED_RECHECK_MS = 6 * 60 * 60_000;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const openingBalanceConfigured = (payload: unknown) => {
  let total = 0;
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const row = value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(row, 'opening_balance_amount')) {
      const amount = Number(row.opening_balance_amount);
      const rate = Number(row.exchange_rate);
      if (Number.isFinite(amount)) total += amount * (Number.isFinite(rate) && rate > 0 ? rate : 1);
      return;
    }
    for (const child of Object.values(row)) visit(child);
  };
  visit(payload);
  return Math.round(total * 100) / 100;
};

const hasOpeningBalanceField = (payload: unknown): boolean => {
  if (Array.isArray(payload)) return payload.some(hasOpeningBalanceField);
  if (!payload || typeof payload !== 'object') return false;
  const row = payload as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(row, 'opening_balance_amount')) return true;
  if (Object.prototype.hasOwnProperty.call(row, 'opening_balances') && Array.isArray(row.opening_balances)) return true;
  return Object.values(row).some(hasOpeningBalanceField);
};

const invoiceEStatus = (it: Record<string, unknown>) => {
  const details = it.einvoice_details && typeof it.einvoice_details === 'object'
    ? it.einvoice_details as Record<string, unknown> : {};
  const value = details.status || it.einvoice_status || it.e_invoice_status;
  return value == null || String(value).trim() === '' ? null : String(value).trim().toLowerCase();
};


const mapInvoice = (it: Record<string, unknown>, now: string) => {
  const modified = it.last_modified_time
    ? new Date(it.last_modified_time as string).toISOString() : null;
  return {
    zoho_id: it.invoice_id,
    invoice_number: it.invoice_number,
    customer_id: it.customer_id || null,
    customer_name: it.customer_name,
    date: it.date || null,
    due_date: it.due_date || null,
    invoice_type: (it.type as string) || null,
    total: Number(it.total) || 0,
    balance: Number(it.balance) || 0,
    status: it.status || null,
    last_modified: modified,
    synced_at: now,
    // The list endpoint often omits this field while the detail endpoint and
    // webhook contain it.  A missing value is merged with the stored status
    // before upsert; it must never erase a known ZATCA state.
    einvoice_status: invoiceEStatus(it),
  };
};

const svc = () => createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

async function preserveInvoiceStatuses(
  db: ReturnType<typeof svc>,
  mapped: Record<string, unknown>[],
) {
  const missing = mapped.filter(row => row.zoho_id && !row.einvoice_status);
  if (!missing.length) return mapped;
  const ids = missing.map(row => String(row.zoho_id));
  const existing = new Map<string, string>();
  for (let start = 0; start < ids.length; start += 180) {
    const { data, error } = await db.from('zoho_invoices')
      .select('zoho_id,einvoice_status').in('zoho_id', ids.slice(start, start + 180));
    if (error) throw new Error(`invoice status read: ${error.message}`);
    for (const row of data || []) {
      if (row.einvoice_status) existing.set(String(row.zoho_id), String(row.einvoice_status));
    }
  }
  for (const row of missing) {
    const status = existing.get(String(row.zoho_id));
    if (status) row.einvoice_status = status;
  }
  return mapped;
}

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
const canZohoRead = (a: { role: string | null; permissions: Record<string, unknown> }) =>
  canPnl(a) || a.permissions?.['zoho.view'] === true;
const canManageConnection = (a: { role: string | null; permissions: Record<string, unknown> }) =>
  a.role === 'admin' || a.permissions?.['zoho.manage_connection'] === true;

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

type ZohoOrganization = {
  id: string;
  name: string;
  currency: string | null;
  isDefault: boolean;
  isActive: boolean;
};

async function persistGrant(
  db: ReturnType<typeof svc>,
  grant: { refreshToken: string; accountsDomain: string; apiDomain: string },
  organization: ZohoOrganization,
) {
  const { error } = await db.from('zoho_auth').upsert({
    id: 1,
    refresh_token: grant.refreshToken,
    accounts_domain: grant.accountsDomain,
    api_domain: grant.apiDomain,
    org_id: organization.id,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`save failed: ${error.message}`);
  return { orgId: organization.id, orgName: organization.name };
}

async function inspectGrant(j: Record<string, unknown>, dc: string) {
  const apiDomain = (j.api_domain as string) || `https://www.zohoapis.${dc}`;
  const r = await fetch(`${apiDomain}/books/v3/organizations`, {
    headers: { Authorization: `Zoho-oauthtoken ${j.access_token}` },
  });
  const payload = await r.json().catch(() => ({}));
  if (!r.ok || payload?.code !== 0 || !Array.isArray(payload?.organizations)) {
    throw new Error(`organizations failed: ${payload?.message || r.status}`);
  }
  const organizations: ZohoOrganization[] = payload.organizations
    .filter((o: Record<string, unknown>) => o.organization_id && o.is_org_active !== false)
    .map((o: Record<string, unknown>) => ({
      id: String(o.organization_id),
      name: String(o.name || o.organization_id),
      currency: o.currency_code ? String(o.currency_code) : null,
      isDefault: o.is_default_org === true,
      isActive: o.is_org_active !== false,
    }));
  if (!organizations.length) throw new Error('لا توجد مؤسسة Zoho Books نشطة لهذا الحساب');
  return {
    grant: {
      refreshToken: String(j.refresh_token),
      accountsDomain: `accounts.zoho.${dc}`,
      apiDomain,
    },
    organizations,
  };
}

async function stageOrPersistGrant(
  db: ReturnType<typeof svc>,
  j: Record<string, unknown>,
  dc: string,
  userId: string,
  existingOrgId: string | null,
  replaceExisting: boolean,
) {
  const { grant, organizations } = await inspectGrant(j, dc);
  if (organizations.length === 1) {
    return { ok: true, ...(await persistGrant(db, grant, organizations[0])), dc };
  }

  // تنظيف مؤقتات هذا المدير المنتهية قبل إنشاء جلسة اختيار جديدة.
  await db.from('zoho_oauth_pending_grants')
    .delete().eq('user_id', userId).lt('expires_at', new Date().toISOString());
  const expiresAt = new Date(Date.now() + OAUTH_PENDING_TTL_MS).toISOString();

  const { data: pending, error } = await db.from('zoho_oauth_pending_grants').insert({
    user_id: userId,
    refresh_token: grant.refreshToken,
    accounts_domain: grant.accountsDomain,
    api_domain: grant.apiDomain,
    organizations,
    existing_org_id: existingOrgId,
    replace_existing: replaceExisting,
    expires_at: expiresAt,
  }).select('id').single();
  if (error || !pending?.id) throw new Error(`pending grant failed: ${error?.message || 'no id'}`);
  return {
    ok: false,
    organization_required: true,
    pending_id: pending.id,
    organizations,
    current_org_id: existingOrgId,
    expires_at: expiresAt,
  };
}

const SEC_ORDERED: [string, RegExp[]][] = [
  ['other_income',  [/الدخل غير التشغيلي/, /non.?operating income/i]],
  ['other_expense', [/المصروفات غير التشغيلية/, /non.?operating expense/i]],
  ['income',        [/الدخل التشغيلي/, /operating income/i]],
  ['cogs',          [/تكلفة السلع/, /cost of goods/i]],
  ['opex',          [/المصروفات التشغيلية/, /operating expense/i]],
];
const NET_PATTERNS = [/صافي الأرباح/, /صافي الربح/, /net profit/i, /net income/i];
type Sec = { name?: string; total?: number | string; total_label?: string; account_transactions?: Sec[] };
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
    if (cronKey && (action === 'sync' || action === 'sync_financial' || action === 'pnl_month')) {
      const { data: za } = await db.from('zoho_auth').select('cron_key').eq('id', 1).maybeSingle();
      if (za?.cron_key && za.cron_key === cronKey) {
        auth = { user: null as never, role: 'admin', permissions: {} };
      }
    }
    if (!auth) auth = await requireUser(req, db);
    if (!auth) return json({ error: 'unauthorized — سجّل دخولك' }, 401);

    if (action === 'exchange_web') {
      if (!canManageConnection(auth)) return json({ error: 'forbidden — تحتاج صلاحية إعادة تفويض زوهو' }, 403);
      const id = Deno.env.get('ZOHO_CLIENT_ID');
      const secret = Deno.env.get('ZOHO_CLIENT_SECRET');
      const code = body.code as string;
      const oauthState = body.state as string;
      if (!id || !secret) return json({ error: 'missing_secrets' }, 400);
      if (!code) return json({ error: 'missing_code' }, 400);
      if (!oauthState || !await verifyZohoOAuthState(oauthState, auth.user.id, secret)) {
        return json({ error: 'invalid_oauth_state — انتهت جلسة الربط أو لم تبدأ من هذا الحساب' }, 403);
      }
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
          if (j.refresh_token) {
            try {
              return json(await stageOrPersistGrant(
                db,
                j,
                dc,
                auth.user.id,
                existing?.org_id || null,
                body.force === true,
              ));
            } catch (setupError) {
              // The authorization code is single-use. Once Zoho returns a refresh token,
              // retrying the same code against another data center only hides the real
              // setup failure behind a misleading `exchange_failed` response.
              return json({
                error: 'grant_setup_failed',
                detail: setupError instanceof Error ? setupError.message : String(setupError),
              }, 500);
            }
          }
          errors[dc] = (j.error as string) || JSON.stringify(j);
        } catch (e) { errors[dc] = String(e); }
      }
      return json({ error: 'exchange_failed', details: errors }, 400);
    }

    if (action === 'finalize_organization') {
      if (!canManageConnection(auth)) return json({ error: 'forbidden — تحتاج صلاحية إعادة تفويض زوهو' }, 403);
      const pendingId = String(body.pending_id || '');
      const organizationId = String(body.organization_id || '');
      if (!/^[0-9a-f-]{36}$/i.test(pendingId) || !/^\d+$/.test(organizationId)) {
        return json({ error: 'invalid organization selection' }, 400);
      }
      const consumedAt = new Date().toISOString();
      const { data: pending, error: claimError } = await db.from('zoho_oauth_pending_grants')
        .update({ consumed_at: consumedAt })
        .eq('id', pendingId)
        .eq('user_id', auth.user.id)

        .is('consumed_at', null)
        .gt('expires_at', consumedAt)
        .select('*')
        .maybeSingle();
      if (claimError) return json({ error: `organization claim failed: ${claimError.message}` }, 500);
      if (!pending) return json({ error: 'organization_selection_expired — ابدأ الربط من جديد' }, 410);

      const organizations = Array.isArray(pending.organizations)
        ? pending.organizations as ZohoOrganization[] : [];
      const selected = organizations.find(o => o.id === organizationId && o.isActive !== false);
      if (!selected || !pending.refresh_token) {
        await db.from('zoho_oauth_pending_grants').update({ consumed_at: null }).eq('id', pendingId);
        return json({ error: 'organization_not_authorized' }, 403);
      }
      const { data: current } = await db.from('zoho_auth')
        .select('refresh_token').eq('id', 1).maybeSingle();
      if (current?.refresh_token && pending.replace_existing !== true) {
        await db.from('zoho_oauth_pending_grants').update({ consumed_at: null }).eq('id', pendingId);
        return json({ error: 'already_connected — أعد الربط وأكّد الاستبدال أولاً' }, 409);
      }
      try {
        const result = await persistGrant(db, {
          refreshToken: pending.refresh_token,
          accountsDomain: pending.accounts_domain,
          apiDomain: pending.api_domain,
        }, selected);
        const { error: clearError } = await db.from('zoho_oauth_pending_grants')
          .delete().eq('id', pendingId).eq('consumed_at', consumedAt);
        if (clearError) console.error('[zoho-sync] pending grant cleanup:', clearError.message);
        return json({ ok: true, ...result });
      } catch (e) {
        await db.from('zoho_oauth_pending_grants').update({ consumed_at: null }).eq('id', pendingId);
        throw e;
      }
    }

    if (action === 'cancel_organization') {
      if (!canManageConnection(auth)) return json({ error: 'forbidden — تحتاج صلاحية إعادة تفويض زوهو' }, 403);
      const pendingId = String(body.pending_id || '');
      if (!/^[0-9a-f-]{36}$/i.test(pendingId)) return json({ error: 'invalid pending grant' }, 400);
      const { error } = await db.from('zoho_oauth_pending_grants')
        .delete().eq('id', pendingId).eq('user_id', auth.user.id);
      if (error) return json({ error: `cancel failed: ${error.message}` }, 500);
      return json({ ok: true });
    }

    if (action === 'download_document') {
      if (!canZohoRead(auth)) return json({ error: 'forbidden — تحتاج صلاحية قراءة زوهو' }, 403);
      const documentType = String(body.document_type || '');
      const documentId = String(body.document_id || '');
      if (!/^\d+$/.test(documentId)) return json({ error: 'invalid_document_id' }, 400);
      if (!['invoice_pdf', 'bill_attachment'].includes(documentType)) {
        return json({ error: 'invalid_document_type' }, 400);
      }

      const { token, apiDomain, orgId } = await accessToken(db);
      const stats: ZohoApiStats = { apiCalls: 0, rateLimited: 0 };
      const path = documentType === 'invoice_pdf'
        ? `/books/v3/invoices/${documentId}?organization_id=${orgId}&accept=pdf`
        : `/books/v3/bills/${documentId}/attachment?organization_id=${orgId}`;
      const upstream = await fetchZohoRaw({
        url: `${apiDomain}${path}`,
        token,
        stats,
        headers: documentType === 'invoice_pdf' ? { Accept: 'application/pdf' } : {},
      });
      await recordZohoUsage(db, orgId, stats);

      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      if (!upstream.ok || contentType.includes('application/json')) {
        const payload = await upstream.json().catch(() => ({} as Record<string, unknown>));
        const message = String(payload?.message || (documentType === 'bill_attachment'
          ? 'لا يوجد مرفق أصلي لهذه الفاتورة'
          : `تعذّر إنشاء ملف PDF (HTTP ${upstream.status})`));
        return json({ error: message }, upstream.status === 404 ? 404 : 400);
      }

      return new Response(upstream.body, {
        status: 200,
        headers: {

          ...CORS,
          'Content-Type': contentType,
          'Cache-Control': 'private, no-store',
          'Content-Disposition': documentType === 'invoice_pdf'
            ? `attachment; filename="invoice-${documentId}.pdf"`
            : `attachment; filename="bill-${documentId}-attachment"`,
        },
      });
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
        const cachedHasSections = Array.isArray(cached?.lines) && cached.lines.length > 0;
        if (cached && cachedHasSections && Date.now() - new Date(cached.fetched_at).getTime() < PNL_TTL_MS) {
          return json({ ok: true, snapshot: cached, cached: true });
        }
      } else {
        from = body.from as string; to = body.to as string;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) {
          return json({ error: 'bad from/to — YYYY-MM-DD' }, 400);
        }
      }
      const { token, apiDomain, orgId } = await accessToken(db);
      const qs = new URLSearchParams({
        organization_id: orgId,
        from_date: from,
        to_date: to,
        cash_based: 'false',
        filter_by: 'TransactionDate.CustomDate',
      });
      const r = await fetch(`${apiDomain}/books/v3/reports/profitandloss?${qs}`, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      });
      const j = await r.json();
      if (j.code !== 0) return json({ error: `zoho: ${j.message || JSON.stringify(j)}`, code: j.code }, 400);
      if (action === 'pnl') return json({ ok: true, from, to, profit_and_loss: j.profit_and_loss ?? j });
      const reportSections = Array.isArray(j.profit_and_loss) ? j.profit_and_loss : [];
      const parsed = parsePnl(reportSections);
      // لا نحفظ صفراً صامتاً إذا تغيّر شكل تقرير زوهو أو عاد بلا أقسام.
      // إبقاء آخر لقطة سليمة أفضل من تحويل «تعذرت القراءة» إلى «ربح = صفر».
      if (!parsed.lines.length) {
        return json({
          error: 'تعذّر قراءة أقسام قائمة الدخل من زوهو؛ لم يتم حفظ أرقام صفرية. أعد المحاولة أو افتح التقرير الرسمي.',
          code: 'pnl_report_unavailable',
          period,
          diagnostics: {
            report_sections: reportSections.length,
            response_keys: Object.keys(j || {}).filter(key => !/token|secret|auth/i.test(key)),
          },
        }, 502);
      }
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

    if (action === 'sync_opening_balances') {
      if (!canZohoRead(auth)) return json({ error: 'forbidden — تحتاج صلاحية قراءة زوهو' }, 403);
      const contactIds = [...new Set(
        (Array.isArray(body.contact_ids) ? body.contact_ids : [])
          .map(value => String(value || '').trim())
          .filter(value => /^\d+$/.test(value)),
      )].slice(0, 100);
      if (!contactIds.length) return json({ error: 'missing_contact_ids' }, 400);

      const { token, apiDomain, orgId } = await accessToken(db);
      const stats: ZohoApiStats = { apiCalls: 0, rateLimited: 0 };
      let updated = 0;
      let failed = 0;
      const failures: string[] = [];

      for (const contactId of contactIds) {
        const { response: detailResponse, payload: detailPayload } = await fetchZohoJson({
          url: `${apiDomain}/books/v3/contacts/${contactId}?organization_id=${orgId}`,
          token,
          stats,
        });
        const detail = (detailPayload as Record<string, any>)?.contact;
        if (!detailResponse.ok || (detailPayload as Record<string, unknown>)?.code !== 0 || !detail) {
          failed++;
          failures.push(`${contactId}: contact ${detailResponse.status}`);
          continue;
        }

        const { response: openingResponse, payload: openingPayload } = await fetchZohoJson({
          url: `${apiDomain}/books/v3/contacts/${contactId}/openingbalances?organization_id=${orgId}`,
          token,
          stats,
        });
        const openingCode = (openingPayload as Record<string, unknown>)?.code;
        const openingEndpointOk = openingResponse.ok
          && (openingCode == null || Number(openingCode) === 0)
          && hasOpeningBalanceField(openingPayload);
        const detailHasOpeningBalance = hasOpeningBalanceField(detail);
        if (!openingEndpointOk && !detailHasOpeningBalance) {
          failed++;
          failures.push(`${contactId}: opening ${openingResponse.status}/${String(openingCode ?? '-')}`);
          continue;
        }

        const checkedAt = new Date().toISOString();
        const configuredOpening = openingEndpointOk
          ? openingBalanceConfigured(openingPayload)
          : openingBalanceConfigured(detail);
        const { error: updateError } = await db.from('zoho_contacts').update({
          opening_balance_configured: configuredOpening,
          opening_balance_checked_at: checkedAt,
          synced_at: checkedAt,
        }).eq('zoho_id', contactId).eq('contact_type', 'customer');
        if (updateError) {
          failed++;
          failures.push(`${contactId}: save ${updateError.message}`);
          continue;
        }
        updated++;
      }

      await recordZohoUsage(db, orgId, stats);
      return json({
        ok: true,
        requested: contactIds.length,
        updated,
        failed,
        failures: failures.slice(0, 20),
        api_calls: stats.apiCalls,
      });
    }

    if (action === 'sync' || action === 'sync_financial') {
      const financialOnly = action === 'sync_financial';
      if (action === 'sync' && body.force !== true && body.full !== true) {

        const { data: recent } = await db.from('zoho_sync_runs')
          .select('finished_at,results,api_calls').eq('status', 'succeeded')
          .order('finished_at', { ascending: false }).limit(1).maybeSingle();
        const recentAt = recent?.finished_at ? new Date(recent.finished_at).getTime() : 0;
        if (recentAt && Date.now() - recentAt < 2 * 60_000) {
          return json({ ok: true, cached: true, reused_recent_sync: true,
            finished_at: recent.finished_at, api_calls: recent.api_calls || 0,
            results: recent.results || {} });
        }
      }
      // zoho_sync_runs يقبل manual/cron/full_rebuild فقط. نوع الكيانات المالية
      // ظاهر أصلاً في results؛ لا نخترع trigger_source يكسره القيد.
      const triggerSource = cronKey ? 'cron'
        : body.full === true ? 'full_rebuild' : 'manual';
      const run = await beginSyncRun(db, triggerSource, auth.user?.id || null);
      const stats: ZohoApiStats = { apiCalls: 0, rateLimited: 0 };
      let usageOrgId = '';
      let usageRecorded = false;
      const results: Record<string, number | string> = {};
      try {
      const { token, apiDomain, orgId } = await accessToken(db);
      usageOrgId = orgId;
      const ENTITIES: { ent: string; listKey: string; table: string;
        sortColumn?: string; noDelta?: boolean; reconcileDeletes?: boolean;
        minIntervalMinutes?: number; financial?: boolean; capability?: string; omitSort?: boolean;
        params?: Record<string, string>;
        requiredScope?: string; optionalScope?: boolean;
        map: (it: Record<string, unknown>, lmIso: string | null, now: string) => Record<string, unknown> }[] = [
        { ent: 'invoices', listKey: 'invoices', table: 'zoho_invoices', reconcileDeletes: true,
          map: (it, _lm, now) => mapInvoice(it, now) },
        { ent: 'customerpayments', listKey: 'customerpayments', table: 'zoho_payments', reconcileDeletes: true, map: (it, lm, now) => ({
          zoho_id: it.payment_id, customer_id: it.customer_id || null,
          customer_name: it.customer_name, date: it.date || null,
          amount: Number(it.amount) || 0, unused_amount: Number(it.unused_amount) || 0, mode: it.payment_mode || null,
          invoice_numbers: (it.invoice_numbers as string) || '', last_modified: lm,
          // A changed payment must be verified from its detail endpoint once.
          unused_checked_at: null, synced_at: now }) },
        { ent: 'creditnotes', listKey: 'creditnotes', table: 'zoho_creditnotes', noDelta: true,
          minIntervalMinutes: 360, reconcileDeletes: true, map: (it, lm, now) => ({
          zoho_id: it.creditnote_id, creditnote_number: it.creditnote_number,
          customer_id: it.customer_id || null, customer_name: it.customer_name,
          date: it.date || null, total: Number(it.total) || 0, balance: Number(it.balance) || 0,
          status: it.status || null, last_modified: lm, synced_at: now }) },
        { ent: 'expenses', listKey: 'expenses', table: 'zoho_expenses', sortColumn: 'date', noDelta: true,
          minIntervalMinutes: 360, reconcileDeletes: true,
          map: (it, lm, now) => ({
          zoho_id: it.expense_id, date: it.date || null,
          account_name: it.account_name || null, vendor_name: it.vendor_name || null,
          total: Number(it.total) || 0, status: it.status || null,
          description: (it.description as string) || null,
          reference_number: (it.reference_number as string) || null, last_modified: lm, synced_at: now }) },
        { ent: 'bills', listKey: 'bills', table: 'zoho_bills', minIntervalMinutes: 120,
          reconcileDeletes: true, map: (it, lm, now) => ({
          zoho_id: it.bill_id, bill_number: it.bill_number || null,
          vendor_id: it.vendor_id || null, vendor_name: it.vendor_name || null,
          date: it.date || null, due_date: it.due_date || null,
          total: Number(it.total) || 0, balance: Number(it.balance) || 0,
          status: it.status || null, last_modified: lm, synced_at: now }) },
        { ent: 'vendorpayments', listKey: 'vendorpayments', table: 'zoho_vendor_payments', minIntervalMinutes: 120,
          reconcileDeletes: true, map: (it, lm, now) => ({
          zoho_id: it.payment_id, vendor_id: it.vendor_id || null,
          vendor_name: it.vendor_name || null, date: it.date || null,
          amount: Number(it.amount) || 0, mode: it.payment_mode || null,
          reference_number: (it.reference_number as string) || null, last_modified: lm, synced_at: now }) },
        { ent: 'journals', listKey: 'journals', table: 'zoho_journals', minIntervalMinutes: 120,
          reconcileDeletes: true, map: (it, lm, now) => ({
          zoho_id: it.journal_id, entry_number: (it.entry_number as string) || null,
          reference_number: (it.reference_number as string) || null,
          date: it.journal_date || it.date || null,
          notes: (it.notes as string) || null, total: Number(it.total) || 0,
          status: (it.status as string) || null, last_modified: lm, synced_at: now }) },
        { ent: 'contacts', listKey: 'contacts', table: 'zoho_contacts', sortColumn: 'contact_name', noDelta: true,
          minIntervalMinutes: 120, reconcileDeletes: true,
          map: (it, lm, now) => ({
          zoho_id: it.contact_id, contact_name: (it.contact_name as string) || null,
          contact_type: (it.contact_type as string) || null,
          outstanding_receivable: Number(it.outstanding_receivable_amount) || 0,
          outstanding_payable: Number(it.outstanding_payable_amount) || 0,
          unused_credits_receivable: Number(it.unused_credits_receivable_amount) || 0,
          unused_credits_payable: Number(it.unused_credits_payable_amount) || 0,

          status: (it.status as string) || null, last_modified: lm, synced_at: now }) },
        { ent: 'bankaccounts', listKey: 'bankaccounts', table: 'zoho_bank_accounts',
          omitSort: true, noDelta: true, minIntervalMinutes: 60,
          reconcileDeletes: true, financial: true, capability: 'banking_read',
          requiredScope: 'ZohoBooks.banking.READ', optionalScope: true,
          map: (it, lm, now) => ({
            zoho_id: it.account_id, account_name: it.account_name || it.bank_name || it.account_id,
            account_code: it.account_code || null, account_type: it.account_type || null,
            currency_code: it.currency_code || null,
            status: it.is_active === false ? 'inactive' : (it.status || 'active'),
            book_balance: Number(it.balance ?? it.book_balance) || 0,
            bank_balance: it.bank_balance == null ? null : Number(it.bank_balance) || 0,
            bcy_balance: it.bcy_balance == null ? null : Number(it.bcy_balance) || 0,
            uncategorized_count: Number(it.uncategorized_transactions) || 0,
            feed_status: it.refresh_status_code
              || (it.is_feeds_active === true ? 'active' : it.is_feeds_subscribed === true ? 'subscribed' : null),
            last_refreshed_at: it.feeds_last_refresh_date || null,
            last_modified: lm, synced_at: now, raw: it,
          }) },
        { ent: 'chartofaccounts', listKey: 'chartofaccounts', table: 'zoho_chart_accounts',
          omitSort: true, params: { showbalance: 'true' }, noDelta: true, minIntervalMinutes: 360,
          reconcileDeletes: true, financial: true, capability: 'chart_of_accounts_read',
          requiredScope: 'ZohoBooks.accountants.READ',
          map: (it, lm, now) => ({
            zoho_id: it.account_id, account_name: it.account_name || it.account_id,
            account_code: it.account_code || null, account_type: it.account_type || null,
            account_type_formatted: it.account_type_formatted || it.account_type || null,
            currency_code: it.currency_code || null,
            status: it.is_active === false ? 'inactive' : (it.status || 'active'),
            current_balance: it.current_balance == null && it.balance == null
              ? null : Number(it.current_balance ?? it.balance) || 0,
            is_user_created: it.is_user_created == null ? null : it.is_user_created === true,
            last_modified: lm, synced_at: now, raw: it,
          }) },
        { ent: 'vendorcredits', listKey: 'vendorcredits', table: 'zoho_vendor_credits',
          sortColumn: 'date', noDelta: true, minIntervalMinutes: 120,
          reconcileDeletes: true, financial: true, capability: 'vendor_credits_read',
          requiredScope: 'ZohoBooks.debitnotes.READ', optionalScope: true,
          map: (it, lm, now) => ({
            zoho_id: it.vendor_credit_id, credit_number: it.vendor_credit_number || it.creditnote_number || null,
            vendor_id: it.vendor_id || null, vendor_name: it.vendor_name || null,
            date: it.date || null, total: Number(it.total) || 0,
            balance: Number(it.balance) || 0, status: it.status || null,
            reference_number: it.reference_number || null, last_modified: lm, synced_at: now,
          }) },
        { ent: 'purchaseorders', listKey: 'purchaseorders', table: 'zoho_purchase_orders',
          sortColumn: 'date', noDelta: true, minIntervalMinutes: 360,
          reconcileDeletes: true, financial: true, capability: 'purchase_orders_read',
          requiredScope: 'ZohoBooks.purchaseorders.READ', optionalScope: true,
          map: (it, lm, now) => ({
            zoho_id: it.purchaseorder_id,
            purchaseorder_number: it.purchaseorder_number || null,
            vendor_id: it.vendor_id || null, vendor_name: it.vendor_name || null,
            date: it.date || null, delivery_date: it.delivery_date || null,
            total: Number(it.total) || 0, status: it.status || null,
            currency_code: it.currency_code || null,
            exchange_rate: it.exchange_rate == null ? null : Number(it.exchange_rate) || 0,
            reference_number: it.reference_number || null,
            last_modified: lm, synced_at: now,
          }) },
        { ent: 'items', listKey: 'items', table: 'zoho_items', omitSort: true,
          noDelta: true, minIntervalMinutes: 720, reconcileDeletes: true,
          financial: true, capability: 'items_read',
          requiredScope: 'ZohoBooks.settings.READ', optionalScope: true,
          map: (it, lm, now) => ({
            zoho_id: it.item_id, name: it.name || it.item_name || it.item_id,
            sku: it.sku || null, item_type: it.item_type || it.product_type || null,
            status: it.status || (it.is_active === false ? 'inactive' : 'active'),
            rate: it.rate == null ? null : Number(it.rate) || 0,
            purchase_rate: it.purchase_rate == null ? null : Number(it.purchase_rate) || 0,
            tax_id: it.tax_id || null, tax_name: it.tax_name || null,
            tax_percentage: it.tax_percentage == null ? null : Number(it.tax_percentage) || 0,
            account_id: it.account_id || null, purchase_account_id: it.purchase_account_id || null,
            raw: it, last_modified: lm, synced_at: now,
          }) },
      ];
      for (const cfg of ENTITIES.filter(cfg => !financialOnly || cfg.financial)) {
        try {
          const { data: st, error: stateReadError } = await db.from('zoho_sync_state')
            .select('last_sync').eq('entity', cfg.ent).maybeSingle();

          if (stateReadError) throw new Error(`state read: ${stateReadError.message}`);
          const lastSyncMs = st?.last_sync ? new Date(st.last_sync).getTime() : 0;
          if (cfg.minIntervalMinutes && body.full !== true && body.force !== true
            && lastSyncMs > Date.now() - cfg.minIntervalMinutes * 60_000) {
            results[cfg.ent] = 'حديث — لم يُسحب مجدداً';
            continue;
          }
          const since = (cfg.noDelta || body.full === true)
            ? null : (st?.last_sync ? new Date(st.last_sync).getTime() : null);
          const runStart = new Date().toISOString();
          let page = 1, saved = 0, more = true, entErr: string | null = null, authBlocked = false;
          const MAX_PAGES = 500;
          while (more && page <= MAX_PAGES) {
            const qs = new URLSearchParams({
              organization_id: orgId, per_page: '200', page: String(page),
            });
            if (!cfg.omitSort) {
              qs.set('sort_column', cfg.sortColumn || 'last_modified_time');
              qs.set('sort_order', 'D');
            }
            for (const [key, value] of Object.entries(cfg.params || {})) qs.set(key, value);
            const { response: r, payload: j } = await fetchZohoJson({
              url: `${apiDomain}/books/v3/${cfg.ent}?${qs}`,
              token,
              stats,
            });
            if (!r.ok || (j as Record<string, unknown>).code !== 0) {
              authBlocked = isZohoAuthorizationError(r, j as Record<string, unknown>);
              entErr = String((j as Record<string, unknown>).message || `HTTP ${r.status} · code ${(j as Record<string, unknown>).code}`);
              break;
            }
            const rows: Record<string, unknown>[] = (j as Record<string, any>)[cfg.listKey] || [];
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
              if (cfg.table === 'zoho_invoices') await preserveInvoiceStatuses(db, mapped);
              const { error } = await db.from(cfg.table).upsert(mapped);
              if (error) { entErr = `save: ${error.message}`; break; }
              saved += mapped.length;
            }
            more = !reachedOld && !!((j as Record<string, any>).page_context?.has_more_page);
            page++;
          }
          if (more) entErr = `تجاوز حد الأمان ${MAX_PAGES} صفحة دون اكتمال`;
          if (entErr) {
            const stateStatus = authBlocked && cfg.optionalScope ? 'needs_reauthorization' : 'failed';
            results[cfg.ent] = authBlocked && cfg.optionalScope
              ? `يتطلب إعادة تفويض (${cfg.requiredScope})`
              : `خطأ: ${entErr}`;
            await db.from('zoho_sync_state').upsert({
              entity: cfg.ent, last_status: stateStatus, last_error: entErr.slice(0, 2000),
              last_run_id: run.id, updated_at: new Date().toISOString(),
            });
            if (cfg.capability) {
              await db.from('zoho_integration_capabilities').upsert({
                capability: cfg.capability,
                endpoint: `/books/v3/${cfg.ent}`,
                required_scope: cfg.requiredScope || null,
                status: authBlocked ? 'needs_reauthorization' : 'error',
                last_checked_at: new Date().toISOString(),
                error_message: entErr.slice(0, 2000),
                updated_at: new Date().toISOString(),
              });
            }
            continue;
          }
          // Reconcile only after a complete full scan.  A delta page contains
          // only changed records, so treating older mirror rows as deleted
          // would be destructive.  Preserve a snapshot before hard deletion.
          if (cfg.reconcileDeletes && !more && since === null) {
            const { data: stale, error: staleError } = await db.from(cfg.table)
              .select('*').lt('synced_at', runStart).limit(5000);
            if (staleError) throw new Error(`reconcile read: ${staleError.message}`);

            if (stale?.length) {
              const tombstones = stale.map(row => ({
                entity: cfg.ent, zoho_id: String(row.zoho_id), snapshot: row, sync_run_id: run.id,
              }));
              const { error: tombstoneError } = await db.from('zoho_mirror_tombstones').insert(tombstones);
              if (tombstoneError) throw new Error(`reconcile audit: ${tombstoneError.message}`);
            }
            const { error: deleteError } = await db.from(cfg.table).delete().lt('synced_at', runStart);
            if (deleteError) throw new Error(`reconcile deletes: ${deleteError.message}`);
            if (stale?.length) results[`${cfg.ent}_deleted`] = stale.length;
          }
          const { error: stateWriteError } = await db.from('zoho_sync_state').upsert({
            entity: cfg.ent, last_sync: new Date().toISOString(), last_count: saved,
            last_status: 'succeeded', last_error: null, last_run_id: run.id,
            updated_at: new Date().toISOString(),
          });
          if (stateWriteError) throw new Error(`state write: ${stateWriteError.message}`);
          if (cfg.capability) {
            const { error: capabilityError } = await db.from('zoho_integration_capabilities').upsert({
              capability: cfg.capability,
              endpoint: `/books/v3/${cfg.ent}`,
              required_scope: cfg.requiredScope || null,
              status: 'available',
              last_checked_at: new Date().toISOString(),
              last_success_at: new Date().toISOString(),
              error_message: null,
              metadata: { rows: saved },
              updated_at: new Date().toISOString(),
            });
            if (capabilityError) throw new Error(`capability save: ${capabilityError.message}`);
          }
          results[cfg.ent] = saved;
        } catch (e) {
          const message = String((e as Error).message || e);
          results[cfg.ent] = `خطأ: ${message}`;
          const { error: stateError } = await db.from('zoho_sync_state').upsert({
            entity: cfg.ent, last_status: 'failed', last_error: message.slice(0, 2000),
            last_run_id: run.id, updated_at: new Date().toISOString(),
          });
          if (stateError) console.error('[zoho-sync] state failure log:', stateError.message);
        }
      }

      // قائمة contacts قد تُرجع رصيداً افتتاحياً قديماً بعد تسديده، بينما
      // GET /contacts/{id} وصفحة العميل في Zoho يعرضان الرصيد الحالي الصحيح.
      // لا نجلب تفاصيل كل العملاء: نراجع فقط من لديهم فرق موجب بين رصيد جهة
      // الاتصال ومجموع الفواتير المفتوحة. الرصيد الافتتاحي الحقيقي سيبقى كما هو،
      // والمسدد سيهبط إلى الرصيد التفصيلي الفعلي.
      // Incremental detail enrichment. List endpoints are kept light; a bounded
      // queue adds line items, taxes, linked bills/POs and account identifiers
      // without exhausting the daily Zoho quota.
      const DETAIL_QUEUES = [
        { table: 'zoho_bills', ent: 'bills', key: 'bill', limit: 25 },
        { table: 'zoho_vendor_payments', ent: 'vendorpayments', key: 'vendorpayment', limit: 20 },
        { table: 'zoho_expenses', ent: 'expenses', key: 'expense', limit: 5 },
        { table: 'zoho_journals', ent: 'journals', key: 'journal', limit: 5 },
        { table: 'zoho_purchase_orders', ent: 'purchaseorders', key: 'purchaseorder', limit: 5 },
      ];
      for (const queue of DETAIL_QUEUES) {
        try {
          const { data: pendingDetails, error: pendingDetailsError } = await db.from(queue.table)
            .select('zoho_id').is('detail_synced_at', null).limit(queue.limit);
          if (pendingDetailsError) throw pendingDetailsError;
          let enriched = 0;
          for (const pending of pendingDetails || []) {
            const qs = new URLSearchParams({ organization_id: orgId });
            const { response, payload } = await fetchZohoJson({
              url: `${apiDomain}/books/v3/${queue.ent}/${pending.zoho_id}?${qs}`,
              token, stats,
            });
            if (!response.ok || (payload as Record<string, unknown>).code !== 0) continue;
            const detail = (payload as Record<string, any>)[queue.key] || {};
            const checkedAt = new Date().toISOString();
            let detailPatch: Record<string, unknown> = { raw_detail: detail, detail_synced_at: checkedAt };
            if (queue.table === 'zoho_bills') detailPatch = {
              ...detailPatch, vendor_id: detail.vendor_id || null,
              sub_total: Number(detail.sub_total) || 0, tax_total: Number(detail.tax_total) || 0,
              currency_code: detail.currency_code || null,
              exchange_rate: detail.exchange_rate == null ? null : Number(detail.exchange_rate) || 0,
              purchaseorder_ids: detail.purchaseorders || detail.purchaseorder_ids || [],

              line_items: detail.line_items || [], taxes: detail.taxes || [],
            };
            if (queue.table === 'zoho_vendor_payments') detailPatch = {
              ...detailPatch, vendor_id: detail.vendor_id || null, bills: detail.bills || [],
              paid_through_account_id: detail.paid_through_account_id || null,
              paid_through_account_name: detail.paid_through_account_name || null,
              currency_code: detail.currency_code || null,
              exchange_rate: detail.exchange_rate == null ? null : Number(detail.exchange_rate) || 0,
              unused_amount: Number(detail.unused_amount) || 0,
            };
            if (queue.table === 'zoho_expenses') detailPatch = {
              ...detailPatch, vendor_id: detail.vendor_id || null,
              currency_code: detail.currency_code || null,
              exchange_rate: detail.exchange_rate == null ? null : Number(detail.exchange_rate) || 0,
              tax_total: Number(detail.tax_total) || 0,
              paid_through_account_id: detail.paid_through_account_id || null,
              paid_through_account_name: detail.paid_through_account_name || null,
              line_items: detail.line_items || [],
            };
            if (queue.table === 'zoho_journals') detailPatch = {
              ...detailPatch, line_items: detail.line_items || [],
            };
            if (queue.table === 'zoho_purchase_orders') detailPatch = {
              ...detailPatch, vendor_id: detail.vendor_id || null, line_items: detail.line_items || [],
            };
            const { error: detailSaveError } = await db.from(queue.table)
              .update(detailPatch).eq('zoho_id', pending.zoho_id);
            if (!detailSaveError) enriched++;
          }
          results[`${queue.ent}_details`] = enriched;
        } catch (detailError) {
          results[`${queue.ent}_details`] = `detail error: ${String((detailError as Error).message || detailError)}`;
        }
      }

      if (!financialOnly) try {
        // فرق الرصيد قد يكون افتتاحياً حقيقياً أو فاتورة سقطت من المزامنة.
        // لا نحسم النوع بالحساب. نجلب بطاقة العميل الصريحة ثم كل فواتيره
        // جلباً موجهاً؛ بعدها تحسم قاعدة البيانات الفرق من مصدر Zoho نفسه.
        const { data: balanceCandidates, error: candidatesError } = await db
          .from('customer_ar')
          .select('zoho_id, contact_name, balance_residual, balance_sync_gap, balance_integrity_status')
          .in('balance_integrity_status', ['unchecked', 'mismatch'])
          .limit(200);
        if (candidatesError) throw candidatesError;
        let refreshed = 0;
        let repairedInvoices = 0;
        let failed = 0;
        const failureReasons: string[] = [];
        for (const candidate of balanceCandidates || []) {
          const { response, payload } = await fetchZohoJson({
            url: `${apiDomain}/books/v3/contacts/${candidate.zoho_id}?organization_id=${orgId}`,
            token,
            stats,
          });
          const detail = (payload as Record<string, any>)?.contact;
          if (!response.ok || (payload as Record<string, unknown>).code !== 0 || !detail) {
            failed++;
            failureReasons.push(
              `${candidate.zoho_id}: contact ${response.status}/${String((payload as Record<string, unknown>)?.code ?? '-')}`
              + ` ${(payload as Record<string, unknown>)?.message || ''}`.trim(),
            );
            continue;
          }
          // Zoho documents contact opening balances under a dedicated endpoint.
          // GET /contacts/{id} may omit the array even when the UI shows a real
          // opening balance, so a successful detail response alone cannot prove 0.
          const { response: openingResponse, payload: openingPayload } = await fetchZohoJson({
            url: `${apiDomain}/books/v3/contacts/${candidate.zoho_id}/openingbalances?organization_id=${orgId}`,
            token,
            stats,
          });
          const openingCode = (openingPayload as Record<string, unknown>)?.code;
          const openingEndpointOk = openingResponse.ok
            && (openingCode == null || Number(openingCode) === 0)
            && hasOpeningBalanceField(openingPayload);
          const detailHasOpeningBalance = hasOpeningBalanceField(detail);
          if (!openingEndpointOk && !detailHasOpeningBalance) {
            failed++;
            failureReasons.push(

              `${candidate.zoho_id}: opening ${openingResponse.status}/${String(openingCode ?? '-')}`
              + ` ${(openingPayload as Record<string, unknown>)?.message || 'no explicit opening balance field'}`.trim(),
            );
            continue;
          }
          const checkedAt = new Date().toISOString();
          const configuredOpening = openingEndpointOk
            ? openingBalanceConfigured(openingPayload)
            : openingBalanceConfigured(detail);
          const { error: updateError } = await db.from('zoho_contacts').update({
            outstanding_receivable: Number(detail.outstanding_receivable_amount) || 0,
            outstanding_payable: Number(detail.outstanding_payable_amount) || 0,
            unused_credits_receivable: Number(detail.unused_credits_receivable_amount) || 0,
            unused_credits_payable: Number(detail.unused_credits_payable_amount) || 0,
            opening_balance_configured: configuredOpening,
            opening_balance_checked_at: checkedAt,
            last_modified: detail.last_modified_time
              ? new Date(detail.last_modified_time as string).toISOString() : null,
            synced_at: checkedAt,
          }).eq('zoho_id', candidate.zoho_id);
          if (updateError) { failed++; continue; }

          // المزامنة الكاملة مرّت قبل هذه الخطوة، فلا نكرر كل فواتير العميل.
          // في الدورات التفاضلية نجلبها لحسم أي فجوة قديمة لم يعد cursor يراها.
          {
            let invoicePage = 1;
            let invoiceMore = true;
            let invoiceFetchFailed = false;
            const liveInvoiceIds: string[] = [];
            while (invoiceMore && invoicePage <= 100) {
              const invoiceQs = new URLSearchParams({
                organization_id: orgId,
                customer_id: String(candidate.zoho_id),
                per_page: '200',
                page: String(invoicePage),
                sort_column: 'date',
                sort_order: 'D',
              });
              const { response: invoiceResponse, payload: invoicePayload } = await fetchZohoJson({
                url: `${apiDomain}/books/v3/invoices?${invoiceQs}`,
                token,
                stats,
              });
              if (!invoiceResponse.ok || (invoicePayload as Record<string, unknown>).code !== 0) {
                invoiceFetchFailed = true;
                break;
              }
              const invoices = ((invoicePayload as Record<string, any>).invoices || []) as Record<string, unknown>[];
              const now = new Date().toISOString();
              const mapped = invoices.filter(invoice => invoice.invoice_id).map(invoice => mapInvoice(invoice, now));
              if (mapped.length) {
                await preserveInvoiceStatuses(db, mapped);
                const { error: invoiceUpsertError } = await db.from('zoho_invoices').upsert(mapped);
                if (invoiceUpsertError) { invoiceFetchFailed = true; break; }
                repairedInvoices += mapped.length;
                liveInvoiceIds.push(...mapped.map(invoice => String(invoice.zoho_id)));
              }
              invoiceMore = !!((invoicePayload as Record<string, any>).page_context?.has_more_page);
              invoicePage++;
            }
            if (invoiceFetchFailed || invoiceMore) { failed++; continue; }

            // بعد جلب مكتمل: احذف من المرآة فقط ما لم يعد موجوداً لهذا العميل.
            // الصفوف القديمة بلا customer_id تُزال بعد أن أعاد upsert تثبيت الحي منها.
            const { data: localInvoiceRows, error: localInvoiceError } = await db.from('zoho_invoices')
              .select('zoho_id').eq('customer_id', candidate.zoho_id);
            if (localInvoiceError) { failed++; continue; }
            const liveSet = new Set(liveInvoiceIds);
            const staleIds = (localInvoiceRows || [])
              .map(row => String(row.zoho_id))
              .filter(id => !liveSet.has(id));
            let staleError: { message?: string } | null = null;
            for (let offset = 0; offset < staleIds.length; offset += 150) {
              const chunk = staleIds.slice(offset, offset + 150);
              const { error } = await db.from('zoho_invoices').delete().in('zoho_id', chunk);
              if (error) { staleError = error; break; }
            }
            const { error: nullIdError } = await db.from('zoho_invoices').delete()
              .eq('customer_name', candidate.contact_name).is('customer_id', null);
            if (staleError || nullIdError) { failed++; continue; }

          }
          refreshed++;
        }
        results.contact_balance_details = failed
          ? `${refreshed} contacts · ${repairedInvoices} invoices · ${failed} failed`
          : `${refreshed} contacts · ${repairedInvoices} invoices`;
        await db.from('zoho_sync_state').upsert({
          entity: 'contact_balance_details', last_sync: new Date().toISOString(),
          last_count: refreshed, last_status: failed ? 'failed' : 'succeeded',
          last_error: failed
            ? (failureReasons.slice(0, 5).join(' | ') || `${failed} contact balance requests failed`).slice(0, 2000)
            : null,
          last_run_id: run.id, updated_at: new Date().toISOString(),
        });
      } catch (e) {
        results.contact_balance_details = `error: ${String((e as Error).message || e)}`;
        await db.from('zoho_sync_state').upsert({
          entity: 'contact_balance_details', last_status: 'failed',
          last_error: String((e as Error).message || e).slice(0, 2000),
          last_run_id: run.id, updated_at: new Date().toISOString(),
        });
      }

      // v29: مصالحة الدفعات ذات الرصيد المفتوح من التفاصيل، دون قراءتها في كل
      // دورة. الدفعة المتغيرة تُصفّر unused_checked_at، والدفعة المستقرة يعاد
      // التحقق منها كل 6 ساعات. 404 = حُذفت في زوهو → تُحذف من المرآة.
      if (!financialOnly) try {
        let openPaymentsQuery = db.from('zoho_payments')
          .select('zoho_id, unused_checked_at')
          .gt('unused_amount', 0.01);
        if (body.full !== true && body.force !== true) {
          const cutoff = new Date(Date.now() - PAYMENT_UNUSED_RECHECK_MS).toISOString();
          openPaymentsQuery = openPaymentsQuery
            .or(`unused_checked_at.is.null,unused_checked_at.lt.${cutoff}`);
        }
        const { data: openPays, error: openPaysError } = await openPaymentsQuery
          .order('unused_checked_at', { ascending: true, nullsFirst: true })
          .limit(40);
        if (openPaysError) throw new Error(`payment refresh queue: ${openPaysError.message}`);
        let refreshed = 0;
        for (const p of openPays || []) {
          const { response: r, payload: j } = await fetchZohoJson({
            url: `${apiDomain}/books/v3/customerpayments/${p.zoho_id}?organization_id=${orgId}`,
            token,
            stats,
          });
          const pay = (j as Record<string, any>)?.payment;
          if ((j as Record<string, unknown>).code === 0 && pay) {
            const { error: refreshError } = await db.from('zoho_payments').update({
              customer_id: pay.customer_id || null,
              amount: Number(pay.amount) || 0,
              unused_amount: Number(pay.unused_amount) || 0,
              invoice_numbers: Array.isArray(pay.invoices)
                ? pay.invoices.map((v: Record<string, unknown>) => v.invoice_number).filter(Boolean).join(', ')
                : '',
              last_modified: pay.last_modified_time ? new Date(pay.last_modified_time as string).toISOString() : null,
              unused_checked_at: new Date().toISOString(),
              synced_at: new Date().toISOString(),
            }).eq('zoho_id', p.zoho_id);
            if (refreshError) throw new Error(`payment refresh save: ${refreshError.message}`);
            refreshed++;
          } else if (r.status === 404) {
            const { error: deleteError } = await db.from('zoho_payments').delete().eq('zoho_id', p.zoho_id);
            if (deleteError) throw new Error(`payment refresh delete: ${deleteError.message}`);
            refreshed++;
          }
          await new Promise(res => setTimeout(res, 120));
        }
        results['payments_refetch'] = refreshed;
      } catch (e) { results['payments_refetch'] = `خطأ: ${String((e as Error).message || e)}`; }

      const partial = Object.values(results).some(v => typeof v === 'string' && v.startsWith('خطأ:'));
      await recordZohoUsage(db, usageOrgId, stats);
      usageRecorded = true;
      await finishSyncRun(db, run.id, partial ? 'partial' : 'succeeded', results, stats.apiCalls);
      return json({ ok: !partial, partial, run_id: run.id, api_calls: stats.apiCalls,
        rate_limited: stats.rateLimited, results });
      } catch (e) {
        const message = String((e as Error).message || e);
        if (!usageRecorded) await recordZohoUsage(db, usageOrgId, stats);

        await finishSyncRun(db, run.id, 'failed', results, stats.apiCalls, message);
        throw e;
      }
    }

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});

