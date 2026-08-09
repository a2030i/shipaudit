// daftra-opening-balances v1 — read-only Daftra client opening balances.
//
// This function intentionally exposes only the fields needed to reconcile
// Daftra opening balances with Zoho. It never writes to Daftra or Zoho and it
// never returns the upstream payload, API key, or client contact details.

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

type DaftraClient = {
  id?: number | string;
  client_number?: string;
  business_name?: string;
  first_name?: string;
  last_name?: string;
  starting_balance?: number | string;
  default_currency_code?: string;
};

type DaftraResponse = {
  code?: number;
  result?: string;
  data?: Array<{ Client?: DaftraClient }>;
  pagination?: {
    page?: number;
    page_count?: number;
    total_results?: number;
    next?: string | null;
  };
};

const serviceClient = () => createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

async function requireReconciliationAccess(req: Request, db: ReturnType<typeof serviceClient>) {
  const authorization = req.headers.get('Authorization') || '';
  if (!authorization.toLowerCase().startsWith('bearer ')) return null;

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authorization } } },
  );
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;

  const { data: profile, error: profileError } = await db
    .from('profiles')
    .select('role, permissions')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError || !profile) return null;

  const permissions = profile.permissions || {};
  const allowed = profile.role === 'admin'
    || permissions['reconciliation.view'] === true;
  return allowed ? { userId: user.id } : null;
}

function normalizeDaftraBaseUrl(raw: string) {
  const withProtocol = /^https:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  const parsed = new URL(withProtocol);
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || (host !== 'daftra.com' && !host.endsWith('.daftra.com'))) {
    throw new Error('invalid_daftra_base_url');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('invalid_daftra_base_url');
  }

  let path = parsed.pathname.replace(/\/+$/, '');
  if (!path || path === '/') path = '/api2';
  if (!path.endsWith('/api2')) throw new Error('invalid_daftra_api_path');
  parsed.pathname = path;
  return parsed.toString().replace(/\/+$/, '');
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchDaftraPage(baseUrl: string, apiKey: string, page: number): Promise<DaftraResponse> {
  const url = new URL(`${baseUrl}/clients.json`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', '100');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          apikey: apiKey,
        },
        signal: controller.signal,
      });

      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await response.body?.cancel();
        await sleep(400 * (attempt + 1));
        continue;
      }
      if (response.status === 401 || response.status === 403) throw new Error('daftra_access_denied');
      if (!response.ok) throw new Error(`daftra_http_${response.status}`);

      const payload = await response.json().catch(() => null) as DaftraResponse | null;
      if (!payload || payload.code !== 200 || !Array.isArray(payload.data)) {
        throw new Error('daftra_invalid_response');
      }
      return payload;
    } catch (error) {
      if (attempt < 2 && error instanceof DOMException && error.name === 'AbortError') {
        await sleep(400 * (attempt + 1));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error('daftra_unavailable');
}

function safeClientName(client: DaftraClient) {
  const business = String(client.business_name || '').trim();
  if (business) return business;
  return [client.first_name, client.last_name]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const db = serviceClient();
  const caller = await requireReconciliationAccess(req, db);
  if (!caller) return json({ ok: false, error: 'forbidden' }, 403);

  try {
    const rawBaseUrl = Deno.env.get('DAFTRA_BASE_URL') || '';
    const apiKey = Deno.env.get('DAFTRA_API_KEY') || '';
    if (!rawBaseUrl || !apiKey) return json({ ok: false, error: 'daftra_not_configured' }, 503);

    const baseUrl = normalizeDaftraBaseUrl(rawBaseUrl);
    const clients: Array<{
      daftra_client_id: string;
      client_number: string;
      client_name: string;
      opening_balance: number;
      currency_code: string;
    }> = [];

    let page = 1;
    let pageCount = 1;
    let declaredTotal = 0;
    do {
      if (page > 500) throw new Error('daftra_pagination_limit');
      const response = await fetchDaftraPage(baseUrl, apiKey, page);
      pageCount = Math.max(1, Number(response.pagination?.page_count) || 1);
      declaredTotal = Number(response.pagination?.total_results) || declaredTotal;

      for (const row of response.data || []) {
        const client = row.Client || {};
        const clientName = safeClientName(client);
        const openingBalance = Number(client.starting_balance ?? 0);
        if (!clientName || !Number.isFinite(openingBalance)) continue;
        clients.push({
          daftra_client_id: String(client.id ?? ''),
          client_number: String(client.client_number ?? ''),
          client_name: clientName,
          opening_balance: Number(openingBalance.toFixed(2)),
          currency_code: String(client.default_currency_code || 'SAR'),
        });
      }
      page += 1;
    } while (page <= pageCount);

    return json({
      ok: true,
      source: 'daftra_api',
      read_only: true,
      count: clients.length,
      declared_total: declaredTotal,
      fetched_at: new Date().toISOString(),
      clients,
    });
  } catch (error) {
    const code = String((error as Error).message || error);
    const status = code === 'daftra_access_denied' ? 502 : 500;
    console.error('daftra-opening-balances failed', { code, caller: caller.userId });
    return json({ ok: false, error: code }, status);
  }
});
