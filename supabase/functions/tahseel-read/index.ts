// tahseel-read v1 — authenticated, read-only gateway to the Tahseel Partner API.
//
// This function deliberately exposes a fixed allow-list of GET operations. It
// cannot create customers, invoices, payment links, notifications, payments,
// refunds, or webhooks in Tahseel.

import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_ORIGIN = 'https://shipaudit-five.vercel.app';
const CORS = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
});

type ReadRequest = {
  action?: string;
  id?: string | number;
  customer_id?: string | number;
  search?: string;
  page?: number;
  limit?: number;
  source_reference?: string;
};

type RouteBuilder = (input: ReadRequest) => { path: string; query?: URLSearchParams };

const requiredId = (value: unknown, label = 'id') => {
  const id = String(value ?? '').trim();
  if (!id || !/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw new Error(`invalid_${label}`);
  return id;
};

const boundedNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
};

const paging = (input: ReadRequest) => {
  const query = new URLSearchParams();
  query.set('page', String(boundedNumber(input.page, 1, 1, 10_000)));
  query.set('limit', String(boundedNumber(input.limit, 50, 1, 200)));
  return query;
};

const READ_ROUTES: Record<string, RouteBuilder> = {
  probe: () => ({ path: '/api/customers', query: new URLSearchParams({ page: '1', limit: '1' }) }),
  list_customers: input => {
    const query = paging(input);
    if (input.search) query.set('search', String(input.search).slice(0, 160));
    return { path: '/api/customers', query };
  },
  get_customer: input => ({ path: `/api/customers/${requiredId(input.id)}` }),
  get_customer_score: input => ({ path: `/api/customers/${requiredId(input.id)}/score` }),
  list_invoices: input => {
    const query = paging(input);
    query.append('relations[]', 'customers');
    return { path: '/api/invoices', query };
  },
  get_invoice: input => ({ path: `/api/invoices/${requiredId(input.id)}` }),
  get_invoice_transactions: input => ({ path: `/api/invoices/${requiredId(input.id)}/transactions` }),
  list_transactions: input => {
    const query = paging(input);
    if (input.customer_id != null) query.set('customerId', requiredId(input.customer_id, 'customer_id'));
    if (input.source_reference) query.set('sourceReference', String(input.source_reference).slice(0, 160));
    return { path: '/api/transactions', query };
  },
  get_transaction: input => ({ path: `/api/transactions/${requiredId(input.id)}` }),
  get_transaction_allocations: input => ({ path: `/api/transactions/${requiredId(input.id)}/allocations` }),
  get_wallet_balance: input => ({ path: `/api/wallets/available-balance/${requiredId(input.customer_id, 'customer_id')}` }),
  list_groups: input => ({ path: '/api/groups', query: paging(input) }),
  get_group_items: input => ({ path: `/api/groups/${requiredId(input.id)}/items`, query: paging(input) }),
  list_tags: input => {
    const query = paging(input);
    if (input.search) query.set('search', String(input.search).slice(0, 160));
    return { path: '/api/tags', query };
  },
  list_tag_assignments: input => ({ path: '/api/tags/assignments', query: paging(input) }),
};

function normalizeBaseUrl(raw: string) {
  const parsed = new URL(raw.trim());
  const allowedHosts = new Set([
    'tahseel-api-prod-liwgaf757q-wx.a.run.app',
    'tahseel-api-dev-liwgaf757q-wx.a.run.app',
  ]);
  if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname.toLowerCase())) {
    throw new Error('invalid_tahseel_base_url');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('invalid_tahseel_base_url');
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  if (path !== '/v1' && path !== '/dev/v1') throw new Error('invalid_tahseel_base_path');
  parsed.pathname = `${path}/`;
  return parsed;
}

async function hmacHex(secret: string, payload: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function requireReadAccess(req: Request) {
  const authorization = req.headers.get('Authorization') || '';
  if (!authorization.toLowerCase().startsWith('bearer ')) return null;

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authorization } } },
  );
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;

  const { data: profile, error: profileError } = await service
    .from('profiles')
    .select('role, permissions')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError || !profile) return null;
  const allowed = profile.role === 'admin' || profile.permissions?.['system.view_settings'] === true;
  return allowed ? { userId: user.id } : null;
}

async function fetchTahseel(input: ReadRequest) {
  const apiKey = String(Deno.env.get('TAHSEEL_API_KEY') || '').trim();
  const apiSecret = String(Deno.env.get('TAHSEEL_API_SECRET') || '').trim();
  const baseUrlRaw = String(Deno.env.get('TAHSEEL_BASE_URL') || '').trim();
  if (!apiKey || !apiSecret || !baseUrlRaw) throw new Error('tahseel_not_configured');

  const buildRoute = READ_ROUTES[String(input.action || 'probe')];
  if (!buildRoute) throw new Error('unsupported_read_action');
  const route = buildRoute(input);
  const baseUrl = normalizeBaseUrl(baseUrlRaw);
  const url = new URL(route.path.replace(/^\/+/, ''), baseUrl);
  if (route.query) url.search = route.query.toString();

  const method = 'GET';
  const body = '';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const requestPathAndQuery = `${url.pathname}${url.search}`;
  const signature = await hmacHex(apiSecret, `${method}${requestPathAndQuery}${body}${timestamp}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        'x-api-key': apiKey,
        'x-timestamp': timestamp,
        'x-signature': signature,
      },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const upstreamMessage = String(payload?.localizedMessage || payload?.message || payload?.error || '').slice(0, 300);
      throw new Error(`tahseel_http_${response.status}${upstreamMessage ? `:${upstreamMessage}` : ''}`);
    }
    if (!payload) throw new Error('tahseel_invalid_response');

    // The production Partner API currently returns the documented
    // `{ success, data }` envelope on some resources and a direct data object
    // on others. Accept only the two known read shapes; never treat an
    // arbitrary 2xx body as valid.
    if (payload.success === true && payload.data != null) {
      return payload;
    }
    if (Array.isArray(payload.list) && Number.isFinite(Number(payload.count))) {
      return { success: true, data: payload };
    }
    if (Array.isArray(payload.data)) {
      return {
        ...payload,
        success: true,
        data: { list: payload.data, count: payload.data.length },
      };
    }
    if (payload.data && typeof payload.data === 'object') {
      const nested = payload.data as Record<string, unknown>;
      if (Array.isArray(nested.list) && Number.isFinite(Number(nested.count))) {
        return { ...payload, success: true };
      }
      // Detail endpoints return `{ message, data: {...} }` in production.
      return { ...payload, success: true };
    }
    throw new Error(`tahseel_invalid_response:${Object.keys(payload).slice(0, 8).join(',')}`);
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const caller = await requireReadAccess(req);
  if (!caller) return json({ ok: false, error: 'forbidden' }, 403);

  try {
    const input = await req.json().catch(() => ({})) as ReadRequest;
    const action = String(input.action || 'probe');
    const payload = await fetchTahseel({ ...input, action });
    const data = payload.data as Record<string, unknown> | undefined;
    if (action === 'probe') {
      return json({
        ok: true,
        read_only: true,
        connected: true,
        resource: 'customers',
        count: Number(data?.count || 0),
        page: Number(data?.page || 1),
        limit: Number(data?.limit || 0),
        checked_at: new Date().toISOString(),
      });
    }
    return json({ ok: true, read_only: true, action, data, checked_at: new Date().toISOString() });
  } catch (error) {
    const code = String((error as Error).message || error);
    const status = code === 'unsupported_read_action' || code.startsWith('invalid_') ? 400
      : code === 'tahseel_not_configured' ? 503
      : code.startsWith('tahseel_http_401') || code.startsWith('tahseel_http_403') ? 502
      : 500;
    console.error('tahseel-read failed', { code: code.split(':', 1)[0], caller: caller.userId });
    return json({ ok: false, read_only: true, error: code }, status);
  }
});
