// daftra-opening-balances v4 — read-only Daftra closing balance reconciliation.
//
// The Daftra client payload exposes `starting_balance`, which is not the
// accounting closing balance.  The closing balance is read from the client's
// journal account: total_debit - total_credit.  That value includes invoices,
// returns, payments, opening entries and manual accounting adjustments.

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
  default_currency_code?: string;
};

type DaftraJournalAccount = {
  id?: number | string;
  entity_type?: string;
  entity_id?: number | string;
  total_debit?: number | string;
  total_credit?: number | string;
  disabled?: boolean | number | string;
};

type DaftraResponse = {
  code?: number;
  result?: string;
  data?: Array<Record<string, unknown>>;
  pagination?: {
    page?: number;
    page_count?: number;
    total_results?: number;
    next?: string | null;
  };
};

type ZohoCustomer = {
  zoho_id: string;
  contact_name: string | null;
  opening_balance_configured: number | string | null;
  opening_balance_checked_at: string | null;
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

async function fetchDaftraPage(
  baseUrl: string,
  apiKey: string,
  resource: 'clients' | 'journal_accounts',
  page: number,
): Promise<DaftraResponse> {
  const url = new URL(`${baseUrl}/${resource}.json`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', '100');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', apikey: apiKey },
        signal: controller.signal,
      });

      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await response.body?.cancel();
        await sleep(500 * (attempt + 1));
        continue;
      }
      if (response.status === 401 || response.status === 403) throw new Error('daftra_access_denied');
      if (!response.ok) throw new Error(`daftra_${resource}_http_${response.status}`);

      const payload = await response.json().catch(() => null) as DaftraResponse | null;
      if (!payload || payload.code !== 200 || !Array.isArray(payload.data)) {
        throw new Error(`daftra_${resource}_invalid_response`);
      }
      return payload;
    } catch (error) {
      if (attempt < 2 && error instanceof DOMException && error.name === 'AbortError') {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error('daftra_unavailable');
}

async function fetchDaftraCollection<T>(
  baseUrl: string,
  apiKey: string,
  resource: 'clients' | 'journal_accounts',
  rowKey: 'Client' | 'JournalAccount',
) {
  const rows: T[] = [];
  let page = 1;
  let pageCount = 1;
  let declaredTotal = 0;
  do {
    if (page > 500) throw new Error('daftra_pagination_limit');
    const response = await fetchDaftraPage(baseUrl, apiKey, resource, page);
    pageCount = Math.max(1, Number(response.pagination?.page_count) || 1);
    declaredTotal = Number(response.pagination?.total_results) || declaredTotal;
    for (const row of response.data || []) {
      const value = row[rowKey];
      if (value && typeof value === 'object') rows.push(value as T);
    }
    page += 1;
  } while (page <= pageCount);
  return { rows, declaredTotal };
}

async function fetchZohoCustomers(db: ReturnType<typeof serviceClient>) {
  const rows: ZohoCustomer[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 100_000; from += pageSize) {
    const { data, error } = await db
      .from('zoho_contacts')
      .select('zoho_id, contact_name, opening_balance_configured, opening_balance_checked_at')
      .eq('contact_type', 'customer')
      .order('zoho_id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`zoho_contacts_read_failed:${error.message}`);
    const page = (data || []) as ZohoCustomer[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
  throw new Error('zoho_contacts_pagination_limit');
}

function safeClientName(client: DaftraClient) {
  const business = String(client.business_name || '').trim();
  if (business) return business;
  return [client.first_name, client.last_name]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

function normalizeName(value: unknown) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ar')
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function toMoney(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
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
    const requestBody = await req.json().catch(() => ({})) as { action?: string };
    if (requestBody.action && requestBody.action !== 'list_closing_balances') {
      return json({ ok: false, error: 'unsupported_action' }, 400);
    }

    const [clientsResult, accountsResult, zohoCustomers] = await Promise.all([
      fetchDaftraCollection<DaftraClient>(baseUrl, apiKey, 'clients', 'Client'),
      fetchDaftraCollection<DaftraJournalAccount>(baseUrl, apiKey, 'journal_accounts', 'JournalAccount'),
      fetchZohoCustomers(db),
    ]);

    const accountTotals = new Map<string, { debit: number; credit: number; accounts: number }>();
    for (const account of accountsResult.rows) {
      if (String(account.entity_type || '').toLowerCase() !== 'client') continue;
      const entityId = String(account.entity_id ?? '').trim();
      if (!entityId) continue;
      const current = accountTotals.get(entityId) || { debit: 0, credit: 0, accounts: 0 };
      current.debit += Number(account.total_debit) || 0;
      current.credit += Number(account.total_credit) || 0;
      current.accounts += 1;
      accountTotals.set(entityId, current);
    }

    const zohoByName = new Map<string, ZohoCustomer[]>();
    for (const customer of zohoCustomers) {
      const key = normalizeName(customer.contact_name);
      if (!key) continue;
      zohoByName.set(key, [...(zohoByName.get(key) || []), customer]);
    }

    const clients = clientsResult.rows.map(client => {
      const daftraClientId = String(client.id ?? '').trim();
      const clientName = safeClientName(client);
      const totals = accountTotals.get(daftraClientId) || { debit: 0, credit: 0, accounts: 0 };
      const closingBalance = toMoney(totals.debit - totals.credit);
      const candidates = zohoByName.get(normalizeName(clientName)) || [];

      let matchStatus = 'unmatched';
      let zoho: ZohoCustomer | null = null;
      if (candidates.length > 1) matchStatus = 'ambiguous';
      if (candidates.length === 1) {
        zoho = candidates[0];
        if (zoho.opening_balance_checked_at == null || zoho.opening_balance_configured == null) {
          matchStatus = 'zoho_unchecked';
        } else {
          const difference = closingBalance - Number(zoho.opening_balance_configured || 0);
          matchStatus = Math.abs(difference) <= 0.005 ? 'matched' : 'different';
        }
      }

      const zohoOpening = zoho?.opening_balance_configured == null
        ? null
        : toMoney(zoho.opening_balance_configured);
      return {
        daftra_client_id: daftraClientId,
        client_number: String(client.client_number ?? ''),
        client_name: clientName,
        currency_code: String(client.default_currency_code || 'SAR'),
        total_debit: toMoney(totals.debit),
        total_credit: toMoney(totals.credit),
        closing_balance: closingBalance,
        journal_account_count: totals.accounts,
        zoho_contact_id: zoho?.zoho_id || null,
        zoho_contact_name: zoho?.contact_name || null,
        zoho_opening_balance: zohoOpening,
        zoho_opening_checked_at: zoho?.opening_balance_checked_at || null,
        difference: zohoOpening == null ? null : toMoney(closingBalance - zohoOpening),
        match_status: matchStatus,
      };
    }).filter(client => client.client_name);

    const matchedRows = clients.filter(row => row.zoho_opening_balance != null);
    const totals = {
      clients: clients.length,
      non_zero: clients.filter(row => Math.abs(row.closing_balance) > 0.005).length,
      daftra_closing: toMoney(clients.reduce((sum, row) => sum + row.closing_balance, 0)),
      zoho_opening_matched: toMoney(matchedRows.reduce((sum, row) => sum + Number(row.zoho_opening_balance || 0), 0)),
      difference_matched: toMoney(matchedRows.reduce((sum, row) => sum + Number(row.difference || 0), 0)),
      matched: clients.filter(row => row.match_status === 'matched').length,
      different: clients.filter(row => row.match_status === 'different').length,
      zoho_unchecked: clients.filter(row => row.match_status === 'zoho_unchecked').length,
      ambiguous: clients.filter(row => row.match_status === 'ambiguous').length,
      unmatched: clients.filter(row => row.match_status === 'unmatched').length,
    };

    return json({
      ok: true,
      source: 'daftra_journal_accounts',
      comparison_source: 'zoho_contacts.opening_balance_configured',
      calculation: 'total_debit - total_credit',
      read_only: true,
      count: clients.length,
      declared_clients: clientsResult.declaredTotal,
      declared_journal_accounts: accountsResult.declaredTotal,
      fetched_at: new Date().toISOString(),
      totals,
      clients,
    });
  } catch (error) {
    const code = String((error as Error).message || error);
    const status = code === 'daftra_access_denied' ? 502 : 500;
    console.error('daftra-closing-balances failed', { code, caller: caller.userId });
    return json({ ok: false, error: code }, status);
  }
});
