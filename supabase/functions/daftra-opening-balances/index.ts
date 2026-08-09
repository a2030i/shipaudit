// daftra-opening-balances v8 — read-only Daftra receivable reconciliation.
//
// The Daftra client payload exposes `starting_balance`, while journal account
// aggregates can lag behind the live client statement.  For migration and
// reconciliation we therefore use the current amount due on non-draft
// invoices: sum(Invoice.summary_unpaid).  Journal totals remain diagnostic
// metadata only and never drive the Zoho opening-balance comparison.

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
  is_recalculated?: boolean | number | string;
};

type DaftraBalanceSnapshot = {
  daftra_client_id: string;
  client_number: string | null;
  account_number: string | null;
  client_name: string;
  manual_status: string | null;
  employee_name: string | null;
  opening_balance: number | string;
  total_sales: number | string;
  total_returns: number | string;
  net_sales: number | string;
  total_payments: number | string;
  settlements: number | string;
  closing_balance: number | string;
  currency_code: string | null;
  source: string;
  captured_at: string;
};

type DaftraInvoice = {
  id?: number | string;
  client_id?: number | string;
  draft?: boolean | number | string;
  summary_unpaid?: number | string;
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

type ConfirmedContactMatch = {
  daftra_client_id: string;
  zoho_contact_id: string;
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
  resource: 'clients' | 'journal_accounts' | 'invoices',
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
  resource: 'clients' | 'journal_accounts' | 'invoices',
  rowKey: 'Client' | 'JournalAccount' | 'Invoice',
) {
  const rows: T[] = [];
  const appendRows = (response: DaftraResponse) => {
    for (const row of response.data || []) {
      const value = row[rowKey];
      if (value && typeof value === 'object') rows.push(value as T);
    }
  };

  const first = await fetchDaftraPage(baseUrl, apiKey, resource, 1);
  appendRows(first);
  const pageCount = Math.max(1, Number(first.pagination?.page_count) || 1);
  const declaredTotal = Number(first.pagination?.total_results) || rows.length;
  if (pageCount > 500) throw new Error('daftra_pagination_limit');

  // A bounded batch keeps the 8k+ invoice read fast without flooding Daftra.
  for (let page = 2; page <= pageCount; page += 6) {
    const pages = Array.from(
      { length: Math.min(6, pageCount - page + 1) },
      (_, offset) => page + offset,
    );
    const responses = await Promise.all(
      pages.map(currentPage => fetchDaftraPage(baseUrl, apiKey, resource, currentPage)),
    );
    responses.forEach(appendRows);
  }

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

async function fetchConfirmedContactMatches(db: ReturnType<typeof serviceClient>) {
  const { data, error } = await db
    .from('daftra_zoho_contact_matches')
    .select('daftra_client_id, zoho_contact_id');
  if (error) throw new Error(`daftra_zoho_matches_read_failed:${error.message}`);
  return new Map(
    ((data || []) as ConfirmedContactMatch[])
      .map(row => [String(row.daftra_client_id), String(row.zoho_contact_id)] as const),
  );
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
    .replace(/\u0640/g, '')
    .replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0629/g, '\u0647')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const GENERIC_BUSINESS_TOKENS = new Set([
  '\u0645\u0624\u0633\u0633\u0647', '\u0634\u0631\u0643\u0647', '\u0645\u062a\u062c\u0631',
  '\u0627\u0644\u062a\u062c\u0627\u0631\u0647', '\u062a\u062c\u0627\u0631\u0647', '\u0644\u0644\u062a\u062c\u0627\u0631\u0647',
  '\u0627\u0644\u062a\u062c\u0627\u0631\u064a\u0647', '\u0627\u0644\u062e\u062f\u0645\u0627\u062a', '\u062e\u062f\u0645\u0627\u062a',
  '\u0644\u0644\u062e\u062f\u0645\u0627\u062a', '\u0644\u062e\u062f\u0645\u0627\u062a', '\u0627\u0644\u0633\u0639\u0648\u062f\u064a\u0647',
  'company', 'establishment', 'trading', 'trade', 'store', 'shop',
  'service', 'services', 'co', 'llc', 'ltd', 'sa',
]);

function significantNameKey(value: unknown) {
  const tokens = normalizeName(value)
    .split(' ')
    .filter(token => token.length >= 2 && !GENERIC_BUSINESS_TOKENS.has(token));
  return { tokens, compact: tokens.join('') };
}

function isSafePartialNameMatch(left: ReturnType<typeof significantNameKey>, right: ReturnType<typeof significantNameKey>) {
  if (!left.compact || !right.compact) return false;
  const shortest = Math.min(left.compact.length, right.compact.length);
  if (shortest < 5) return false;
  return left.compact.includes(right.compact) || right.compact.includes(left.compact);
}

function toMoney(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

async function fetchDaftraBalanceSnapshot(
  db: ReturnType<typeof serviceClient>,
  periodStart: string,
  periodEnd: string,
) {
  const { data, error } = await db
    .from('daftra_client_balance_snapshots')
    .select('daftra_client_id, client_number, account_number, client_name, manual_status, employee_name, opening_balance, total_sales, total_returns, net_sales, total_payments, settlements, closing_balance, currency_code, source, captured_at')
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .order('daftra_client_id', { ascending: true });
  if (error) throw new Error(`daftra_snapshot_read_failed:${error.message}`);
  const rows = (data || []) as DaftraBalanceSnapshot[];
  if (!rows.length) throw new Error('daftra_period_snapshot_not_found');
  return rows;
}

function matchSnapshotWithZoho(
  snapshotRows: DaftraBalanceSnapshot[],
  zohoCustomers: ZohoCustomer[],
  confirmedMatches: Map<string, string>,
) {
  const zohoByName = new Map<string, ZohoCustomer[]>();
  const zohoById = new Map(zohoCustomers.map(customer => [customer.zoho_id, customer]));
  const zohoNameEntries: Array<{
    customer: ZohoCustomer;
    partialKey: ReturnType<typeof significantNameKey>;
  }> = [];
  for (const customer of zohoCustomers) {
    const key = normalizeName(customer.contact_name);
    if (!key) continue;
    zohoByName.set(key, [...(zohoByName.get(key) || []), customer]);
    zohoNameEntries.push({ customer, partialKey: significantNameKey(customer.contact_name) });
  }

  const clients = snapshotRows.map(row => {
    const closingBalance = toMoney(row.closing_balance);
    const confirmed = zohoById.get(confirmedMatches.get(String(row.daftra_client_id)) || '');
    const exactCandidates = confirmed ? [] : (zohoByName.get(normalizeName(row.client_name)) || []);
    let candidates = confirmed ? [confirmed] : exactCandidates;
    let matchMethod = confirmed ? 'confirmed' : (exactCandidates.length ? 'exact' : 'none');
    if (!confirmed && !exactCandidates.length) {
      const partialKey = significantNameKey(row.client_name);
      const uniquePartial = new Map<string, ZohoCustomer>();
      for (const entry of zohoNameEntries) {
        if (isSafePartialNameMatch(partialKey, entry.partialKey)) {
          uniquePartial.set(entry.customer.zoho_id, entry.customer);
        }
      }
      candidates = [...uniquePartial.values()];
      if (candidates.length) matchMethod = 'partial';
    }

    let matchStatus = 'unmatched';
    let zoho: ZohoCustomer | null = null;
    if (candidates.length > 1) matchStatus = 'ambiguous';
    if (candidates.length === 1) {
      zoho = candidates[0];
      if (matchMethod === 'partial') matchStatus = 'partial_candidate';
      else if (zoho.opening_balance_checked_at == null || zoho.opening_balance_configured == null) matchStatus = 'zoho_unchecked';
      else matchStatus = Math.abs(closingBalance - Number(zoho.opening_balance_configured || 0)) <= 0.005
        ? 'matched'
        : 'different';
    }

    const zohoOpening = zoho?.opening_balance_configured == null
      ? null
      : toMoney(zoho.opening_balance_configured);
    return {
      daftra_client_id: String(row.daftra_client_id),
      client_number: row.client_number || String(row.daftra_client_id),
      account_number: row.account_number || '',
      client_name: row.client_name,
      manual_status: row.manual_status || '',
      employee_name: row.employee_name || '',
      opening_balance: toMoney(row.opening_balance),
      total_sales: toMoney(row.total_sales),
      total_returns: toMoney(row.total_returns),
      net_sales: toMoney(row.net_sales),
      total_payments: toMoney(row.total_payments),
      settlements: toMoney(row.settlements),
      closing_balance: closingBalance,
      currency_code: row.currency_code || 'SAR',
      source: row.source,
      captured_at: row.captured_at,
      zoho_contact_id: zoho?.zoho_id || null,
      zoho_contact_name: zoho?.contact_name || null,
      zoho_opening_balance: zohoOpening,
      zoho_opening_checked_at: zoho?.opening_balance_checked_at || null,
      difference: zohoOpening == null ? null : toMoney(closingBalance - zohoOpening),
      match_status: matchStatus,
      match_method: matchMethod,
      match_candidate_count: candidates.length,
    };
  }).filter(row => Math.abs(row.closing_balance) > 0.005);

  const matchedRows = clients.filter(row => row.zoho_opening_balance != null);
  const positiveRows = clients.filter(row => row.closing_balance > 0.005);
  const creditRows = clients.filter(row => row.closing_balance < -0.005);
  return {
    clients,
    totals: {
      clients: clients.length,
      non_zero: clients.length,
      positive: positiveRows.length,
      credit: creditRows.length,
      daftra_positive: toMoney(positiveRows.reduce((sum, row) => sum + row.closing_balance, 0)),
      daftra_credit: toMoney(creditRows.reduce((sum, row) => sum + row.closing_balance, 0)),
      daftra_closing: toMoney(clients.reduce((sum, row) => sum + row.closing_balance, 0)),
      zoho_opening_matched: toMoney(matchedRows.reduce((sum, row) => sum + Number(row.zoho_opening_balance || 0), 0)),
      difference_matched: toMoney(matchedRows.reduce((sum, row) => sum + Number(row.difference || 0), 0)),
      matched: clients.filter(row => row.match_status === 'matched').length,
      different: clients.filter(row => row.match_status === 'different').length,
      zoho_unchecked: clients.filter(row => row.match_status === 'zoho_unchecked').length,
      partial_candidate: clients.filter(row => row.match_status === 'partial_candidate').length,
      ambiguous: clients.filter(row => row.match_status === 'ambiguous').length,
      unmatched: clients.filter(row => row.match_status === 'unmatched').length,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const db = serviceClient();
  const caller = await requireReconciliationAccess(req, db);
  if (!caller) return json({ ok: false, error: 'forbidden' }, 403);

  try {
    const requestBody = await req.json().catch(() => ({})) as {
      action?: string;
      period_start?: string;
      period_end?: string;
    };
    const action = requestBody.action || 'list_closing_balances';

    if (action === 'list_period_closing_balances') {
      const periodStart = String(requestBody.period_start || '2026-01-01');
      const periodEnd = String(requestBody.period_end || '2026-01-31');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
        return json({ ok: false, error: 'invalid_period' }, 400);
      }
      const [snapshotRows, zohoCustomers, confirmedMatches] = await Promise.all([
        fetchDaftraBalanceSnapshot(db, periodStart, periodEnd),
        fetchZohoCustomers(db),
        fetchConfirmedContactMatches(db),
      ]);
      const reconciliation = matchSnapshotWithZoho(snapshotRows, zohoCustomers, confirmedMatches);
      return json({
        ok: true,
        source: 'daftra_client_balance_snapshot',
        comparison_source: 'zoho_contacts.opening_balance_configured',
        calculation: 'official_daftra_clients_balance_report_closing_balance',
        period_start: periodStart,
        period_end: periodEnd,
        read_only: true,
        count: reconciliation.clients.length,
        fetched_at: new Date().toISOString(),
        totals: reconciliation.totals,
        clients: reconciliation.clients,
      });
    }
    if (action !== 'list_closing_balances') {
      return json({ ok: false, error: 'unsupported_action' }, 400);
    }

    const rawBaseUrl = Deno.env.get('DAFTRA_BASE_URL') || '';
    const apiKey = Deno.env.get('DAFTRA_API_KEY') || '';
    if (!rawBaseUrl || !apiKey) return json({ ok: false, error: 'daftra_not_configured' }, 503);

    const baseUrl = normalizeDaftraBaseUrl(rawBaseUrl);
    const [clientsResult, accountsResult, invoicesResult, zohoCustomers, confirmedMatches] = await Promise.all([
      fetchDaftraCollection<DaftraClient>(baseUrl, apiKey, 'clients', 'Client'),
      fetchDaftraCollection<DaftraJournalAccount>(baseUrl, apiKey, 'journal_accounts', 'JournalAccount'),
      fetchDaftraCollection<DaftraInvoice>(baseUrl, apiKey, 'invoices', 'Invoice'),
      fetchZohoCustomers(db),
      fetchConfirmedContactMatches(db),
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

    const invoiceDueTotals = new Map<string, { due: number; invoices: number }>();
    for (const invoice of invoicesResult.rows) {
      const clientId = String(invoice.client_id ?? '').trim();
      if (!clientId) continue;
      const draft = invoice.draft === true || invoice.draft === 1 || invoice.draft === '1' || invoice.draft === 'true';
      if (draft) continue;
      const current = invoiceDueTotals.get(clientId) || { due: 0, invoices: 0 };
      current.due += Number(invoice.summary_unpaid) || 0;
      current.invoices += 1;
      invoiceDueTotals.set(clientId, current);
    }

    const zohoByName = new Map<string, ZohoCustomer[]>();
    const zohoById = new Map(zohoCustomers.map(customer => [customer.zoho_id, customer]));
    const zohoNameEntries: Array<{
      customer: ZohoCustomer;
      partialKey: ReturnType<typeof significantNameKey>;
    }> = [];
    for (const customer of zohoCustomers) {
      const key = normalizeName(customer.contact_name);
      if (!key) continue;
      zohoByName.set(key, [...(zohoByName.get(key) || []), customer]);
      zohoNameEntries.push({ customer, partialKey: significantNameKey(customer.contact_name) });
    }

    const clients = clientsResult.rows.map(client => {
      const daftraClientId = String(client.id ?? '').trim();
      const clientName = safeClientName(client);
      const totals = accountTotals.get(daftraClientId) || { debit: 0, credit: 0, accounts: 0 };
      const invoiceDue = invoiceDueTotals.get(daftraClientId) || { due: 0, invoices: 0 };
      const closingBalance = toMoney(invoiceDue.due);
      const normalizedClientName = normalizeName(clientName);
      const confirmed = zohoById.get(confirmedMatches.get(daftraClientId) || '');
      const exactCandidates = confirmed ? [] : (zohoByName.get(normalizedClientName) || []);
      let candidates = confirmed ? [confirmed] : exactCandidates;
      let matchMethod = confirmed ? 'confirmed' : (exactCandidates.length ? 'exact' : 'none');
      if (!confirmed && !exactCandidates.length) {
        const partialKey = significantNameKey(clientName);
        const uniquePartial = new Map<string, ZohoCustomer>();
        for (const entry of zohoNameEntries) {
          if (isSafePartialNameMatch(partialKey, entry.partialKey)) {
            uniquePartial.set(entry.customer.zoho_id, entry.customer);
          }
        }
        candidates = [...uniquePartial.values()];
        if (candidates.length) matchMethod = 'partial';
      }

      let matchStatus = 'unmatched';
      let zoho: ZohoCustomer | null = null;
      if (candidates.length > 1) matchStatus = 'ambiguous';
      if (candidates.length === 1) {
        zoho = candidates[0];
        if (matchMethod === 'partial') {
          matchStatus = 'partial_candidate';
        } else if (zoho.opening_balance_checked_at == null || zoho.opening_balance_configured == null) {
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
        open_invoice_count: invoiceDue.invoices,
        journal_account_count: totals.accounts,
        zoho_contact_id: zoho?.zoho_id || null,
        zoho_contact_name: zoho?.contact_name || null,
        zoho_opening_balance: zohoOpening,
        zoho_opening_checked_at: zoho?.opening_balance_checked_at || null,
        difference: zohoOpening == null ? null : toMoney(closingBalance - zohoOpening),
        match_status: matchStatus,
        match_method: matchMethod,
        match_candidate_count: candidates.length,
      };
    }).filter(client => client.client_name);

    const matchedRows = clients.filter(row => row.zoho_opening_balance != null);
    const totals = {
      clients: clients.length,
      non_zero: clients.filter(row => Math.abs(row.closing_balance) > 0.005).length,
      daftra_due: toMoney(clients.reduce((sum, row) => sum + row.closing_balance, 0)),
      daftra_closing: toMoney(clients.reduce((sum, row) => sum + row.closing_balance, 0)),
      zoho_opening_matched: toMoney(matchedRows.reduce((sum, row) => sum + Number(row.zoho_opening_balance || 0), 0)),
      difference_matched: toMoney(matchedRows.reduce((sum, row) => sum + Number(row.difference || 0), 0)),
      matched: clients.filter(row => row.match_status === 'matched').length,
      different: clients.filter(row => row.match_status === 'different').length,
      zoho_unchecked: clients.filter(row => row.match_status === 'zoho_unchecked').length,
      partial_candidate: clients.filter(row => row.match_status === 'partial_candidate').length,
      ambiguous: clients.filter(row => row.match_status === 'ambiguous').length,
      unmatched: clients.filter(row => row.match_status === 'unmatched').length,
    };

    return json({
      ok: true,
      source: 'daftra_invoices_summary_unpaid',
      comparison_source: 'zoho_contacts.opening_balance_configured',
      calculation: 'sum(non_draft_invoice.summary_unpaid)',
      read_only: true,
      count: clients.length,
      declared_clients: clientsResult.declaredTotal,
      declared_journal_accounts: accountsResult.declaredTotal,
      declared_invoices: invoicesResult.declaredTotal,
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
