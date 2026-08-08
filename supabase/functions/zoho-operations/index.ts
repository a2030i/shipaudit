// Controlled Zoho Books operations. Invoice lifecycle and explicit bank matching
// may write after confirmation. Bank-statement comparison is read-only: ShipAudit
// never uploads statement rows to Zoho; it only returns missing rows for Excel export.
import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_ORIGIN = 'https://shipaudit-five.vercel.app';
const CORS = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, 'Content-Type': 'application/json' },
});
const svc = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

async function requirePermission(req: Request, db: ReturnType<typeof svc>, permission: string) {
  const auth = req.headers.get('Authorization') || '';
  const uc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await uc.auth.getUser();
  if (!user) return null;
  const { data: p } = await db.from('profiles').select('role,permissions').eq('id', user.id).maybeSingle();
  if (p?.role !== 'admin' && p?.permissions?.[permission] !== true) return null;
  return user;
}

async function requirePermissions(req: Request, db: ReturnType<typeof svc>, permissions: string[]) {
  const auth = req.headers.get('Authorization') || '';
  const uc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await uc.auth.getUser();
  if (!user) return null;
  const { data: p } = await db.from('profiles').select('role,permissions').eq('id', user.id).maybeSingle();
  if (p?.role !== 'admin' && permissions.some(permission => p?.permissions?.[permission] !== true)) return null;
  return user;
}

async function accessToken(db: ReturnType<typeof svc>) {
  const { data } = await db.from('zoho_auth').select('*').eq('id', 1).maybeSingle();
  if (!data?.refresh_token) throw new Error('zoho_not_connected');
  const r = await fetch(`https://${data.accounts_domain}/oauth/v2/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: Deno.env.get('ZOHO_CLIENT_ID')!,
      client_secret: Deno.env.get('ZOHO_CLIENT_SECRET')!, refresh_token: data.refresh_token }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`zoho_refresh_failed:${j.error || r.status}`);
  return { token: String(j.access_token), apiDomain: String(data.api_domain), orgId: String(data.org_id) };
}

async function zjson(url: string, init: RequestInit, options: { retryPortal?: boolean; timeoutMs?: number } = {}) {
  const attempts = options.retryPortal ? 2 : 2;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const r = await fetch(url, { ...init, signal: init.signal || AbortSignal.timeout(options.timeoutMs || 20_000) });
      const body = await r.json().catch(() => ({}));
      const portalMessage = String(body?.message || body?.error || '');
      const retryable = r.status === 429 || (options.retryPortal
        && ([41051, -1, 503].includes(Number(body?.code)) || /503|temporar|proxy|مؤقت/i.test(portalMessage)));
      if (retryable && attempt + 1 < attempts) {
        await new Promise(resolve => setTimeout(resolve, options.retryPortal ? 2_500 : 1_200));
        continue;
      }
      return { r, body };
    } catch (error) {
      if (attempt + 1 < attempts) {
        await new Promise(resolve => setTimeout(resolve, 1_200));
        continue;
      }
      const timeout = error instanceof DOMException && error.name === 'TimeoutError';
      return { r: { ok: false, status: timeout ? 504 : 502 }, body: {
        code: timeout ? 504 : 502,
        message: timeout ? 'انتهت مهلة استجابة زوهو. ستبقى الفاتورة معلقة لإعادة المحاولة.'
          : (error instanceof Error ? error.message : String(error)),
      } };
    }
  }
  return { r: { ok: false, status: 504 }, body: { code: 504, message: 'انتهت مهلة استجابة زوهو.' } };
}

const normalizedRef = (value: unknown) => String(value || '').trim().toLocaleLowerCase();
const localTxnDate = (t: any) => String(t?.txn_at || t?.txn_date || '').slice(0, 10);
const normalizedBankText = (value: unknown) => String(value || '')
  .normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const bankTransactionId = (row: any) => String(row?.transaction_id || row?.imported_transaction_id
  || row?.bank_transaction_id || row?.statement_transaction_id || row?.id || '');
const bankTransactionAmount = (row: any) => Math.abs(Number(row?.amount ?? row?.total ?? row?.transaction_amount
  ?? row?.debit ?? row?.credit ?? 0));
const bankTransactionDirection = (row: any) => {
  const value = String(row?.direction || row?.debit_or_credit || row?.transaction_type || row?.type || '').toLowerCase();
  if (/credit|deposit|inflow|إيداع/.test(value) || Number(row?.credit) > 0) return 'credit';
  if (/debit|withdraw|outflow|سحب/.test(value) || Number(row?.debit) > 0) return 'debit';
  return Number(row?.amount) < 0 ? 'debit' : 'credit';
};
const bankTransactionDate = (row: any) => String(row?.date || row?.transaction_date
  || row?.value_date || row?.txn_at || row?.txn_date || '').slice(0, 10);
const bankTransactionText = (row: any) => normalizedBankText(row?.description || row?.narration
  || row?.details || row?.notes || row?.payee || row?.payee_name || row?.customer_name || row?.vendor_name);
const zohoRowBelongsToAccount = (row: any, accountId: string) => [
  row?.account_id, row?.from_account_id, row?.to_account_id,
].some(value => value != null && String(value) === accountId);
const bankTransactionFingerprint = (row: any) => {
  const date = bankTransactionDate(row);
  const direction = bankTransactionDirection(row);
  const amount = bankTransactionAmount(row);
  const text = bankTransactionText(row);
  if (!date || !direction || !Number.isFinite(amount) || amount <= 0 || !text) return '';
  return `${date}|${direction}|${amount.toFixed(2)}|${text}`;
};

const ZOHO_BANK_PAGE_SIZE = 200;
const ZOHO_BANK_MAX_PAGES = 50;
const LOCAL_BANK_PAGE_SIZE = 1000;
const LOCAL_BANK_MAX_ROWS = 20_000;

// A categorized Zoho bank transaction can contain the original imported
// statement row inside `imported_transactions`.  The original reference is
// the reliable key for comparing a bank statement with Zoho, so keep both the
// accounting transaction and every embedded statement row in the inventory.
const expandZohoBankTransactionRows = (rows: any[]) => rows.flatMap((row: any) => {
  const nested = Array.isArray(row?.imported_transactions) ? row.imported_transactions : [];
  if (!nested.length) return [row];
  const inheritedDirection = bankTransactionDirection(row);
  return [row, ...nested.map((imported: any) => ({
    ...imported,
    account_id: imported?.account_id,
    from_account_id: imported?.from_account_id || row?.from_account_id,
    to_account_id: imported?.to_account_id || row?.to_account_id,
    direction: imported?.direction || imported?.debit_or_credit || inheritedDirection,
    transaction_type: imported?.transaction_type || row?.transaction_type,
    description: imported?.description || row?.description,
    payee: imported?.payee || row?.payee,
  }))];
});

async function loadAllLocalBankTransactions(db: ReturnType<typeof svc>, bank: string) {
  const collected: any[] = [];
  for (let from = 0; from < LOCAL_BANK_MAX_ROWS; from += LOCAL_BANK_PAGE_SIZE) {
    const { data, error } = await db.from('bank_transactions')
      .select('id,dedup_key,txn_date,txn_at,reference,description,debit,credit,bank')
      .eq('bank', bank)
      .order('txn_date', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + LOCAL_BANK_PAGE_SIZE - 1);
    if (error) throw new Error(`bank_read:${error.message}`);
    const rows = data || [];
    collected.push(...rows);
    if (rows.length < LOCAL_BANK_PAGE_SIZE) return collected;
  }
  throw new Error('local_bank_transactions_incomplete');
}

async function lastImportedBankAnchor(access: { token: string; apiDomain: string; orgId: string }, accountId: string) {
  const url = `${access.apiDomain}/books/v3/bankaccounts/${encodeURIComponent(accountId)}/statement/lastimported?organization_id=${encodeURIComponent(access.orgId)}`;
  const z = await zjson(url, { method: 'GET', headers: { Authorization: `Zoho-oauthtoken ${access.token}` } });
  const message = String(z.body?.message || '');
  if (z.r.status === 404 || /no .*statement|not found/i.test(message)) return null;
  if (!z.r.ok || z.body?.code !== 0) throw new Error(`zoho_last_statement:${message || z.r.status}`);
  const statements = Array.isArray(z.body?.statement) ? z.body.statement : [];
  const transactions = statements.flatMap((statement: any) => Array.isArray(statement?.transactions)
    ? statement.transactions.map((transaction: any) => ({ ...transaction, statement_id: statement.statement_id })) : []);
  transactions.sort((a: any, b: any) => String(a.date || '').localeCompare(String(b.date || ''))
    || String(a.transaction_id || '').localeCompare(String(b.transaction_id || '')));
  const last = transactions.at(-1);
  if (!last) return null;
  return {
    date: String(last.date || '').slice(0, 10),
    reference: String(last.reference_number || ''),
    transactionId: String(last.transaction_id || ''),
    statementId: String(last.statement_id || ''),
    knownReferences: new Set(transactions.map((t: any) => normalizedRef(t.reference_number)).filter(Boolean)),
    knownTransactionIds: new Set(transactions.map((t: any) => String(t.transaction_id || '')).filter(Boolean)),
    knownFingerprints: new Set(transactions.map(bankTransactionFingerprint).filter(Boolean)),
    transactions,
  };
}

async function liveZohoBankTransactionSnapshot(
  access: { token: string; apiDomain: string; orgId: string },
  accountId: string,
  period: { start?: string; end?: string } = {},
) {
  const collected: any[] = [];
  let truncated = false;
  for (let page = 1; page <= ZOHO_BANK_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      organization_id: access.orgId,
      account_id: accountId,
      filter_by: 'Status.All',
      sort_column: 'date',
      page: String(page),
      per_page: String(ZOHO_BANK_PAGE_SIZE),
    });
    if (period.start) params.set('date_start', period.start);
    if (period.end) params.set('date_end', period.end);
    const url = `${access.apiDomain}/books/v3/banktransactions?${params.toString()}`;
    const z = await zjson(url, { method: 'GET', headers: { Authorization: `Zoho-oauthtoken ${access.token}` } });
    if (!z.r.ok || z.body?.code !== 0) throw new Error(`zoho_bank_transactions:${String(z.body?.message || z.r.status)}`);
    const rows = Array.isArray(z.body?.banktransactions) ? z.body.banktransactions : [];
    collected.push(...expandZohoBankTransactionRows(rows));
    const hasMore = Boolean(z.body?.page_context?.has_more_page);
    if (!hasMore || !rows.length) break;
    if (page === ZOHO_BANK_MAX_PAGES) truncated = true;
  }
  if (truncated) throw new Error('zoho_bank_transactions_incomplete');
  const byId = new Map<string, any>();
  // Zoho's list endpoint can return rows outside the requested account when
  // filters are ignored. Never treat an unscoped row as proof of presence.
  collected.filter((row: any) => zohoRowBelongsToAccount(row, accountId))
    .forEach((row: any, index: number) => {
      const id = bankTransactionId(row);
      const fingerprint = bankTransactionFingerprint(row);
      const reference = normalizedRef(row.reference_number || row.reference);
      const key = id || fingerprint || (reference ? `reference:${reference}:${bankTransactionDate(row)}` : `row:${index}`);
      if (!byId.has(key)) byId.set(key, row);
    });
  const rows = [...byId.values()].sort((a: any, b: any) =>
    String(a.date || a.transaction_date || '').localeCompare(String(b.date || b.transaction_date || ''))
    || String(a.transaction_id || a.bank_transaction_id || '').localeCompare(String(b.transaction_id || b.bank_transaction_id || '')));
  const last = rows.at(-1);
  if (!last) return null;
  return {
    date: String(last.date || last.transaction_date || '').slice(0, 10),
    reference: String(last.reference_number || last.reference || ''),
    transactionId: bankTransactionId(last),
    statementId: '', source: 'zoho_live_transactions', count: rows.length,
    knownReferences: new Set(rows.map((t: any) => normalizedRef(t.reference_number || t.reference)).filter(Boolean)),
    knownTransactionIds: new Set(rows.map(bankTransactionId).filter(Boolean)),
    knownFingerprints: new Set(rows.map(bankTransactionFingerprint).filter(Boolean)),
    transactions: rows,
  };
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

const exportBatchView = (batch: any, items: any[] = []) => ({
  id: String(batch?.id || ''),
  account_id: String(batch?.zoho_account_id || ''),
  bank: String(batch?.internal_bank_name || ''),
  file_name: String(batch?.file_name || ''),
  row_count: Number(batch?.row_count || 0),
  status: String(batch?.status || 'exported'),
  exported_at: batch?.exported_at || null,
  last_verified_at: batch?.last_verified_at || null,
  seen_count: Number(batch?.seen_count || 0),
  missing_count: Number(batch?.missing_count || 0),
  duplicate_count: Number(batch?.duplicate_count || 0),
  verification_summary: batch?.verification_summary || {},
  items: items.map(item => ({
    id: item.id,
    bank_transaction_id: item.bank_transaction_id,
    reference: item.reference_number,
    date: item.transaction_date,
    direction: item.direction,
    amount: Number(item.amount || 0),
    status: item.status,
    zoho_transaction_id: item.zoho_transaction_id,
    match_method: item.match_method,
  })),
});

async function latestBankExportBatch(db: ReturnType<typeof svc>, accountId: string) {
  const { data: batch, error } = await db.from('zoho_bank_export_batches').select('*')
    .eq('zoho_account_id', accountId).order('exported_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`bank_export_batch_read:${error.message}`);
  if (!batch) return null;
  const { data: items, error: itemsError } = await db.from('zoho_bank_export_items').select('*')
    .eq('batch_id', batch.id).order('transaction_date', { ascending: true }).order('id', { ascending: true });
  if (itemsError) throw new Error(`bank_export_items_read:${itemsError.message}`);
  return exportBatchView(batch, items || []);
}

const verificationInventory = (liveAnchor: any, importedStatementAnchor: any, unreviewed: any[]) => {
  const rows = [
    ...((liveAnchor?.transactions || []).map((row: any) => ({ ...row, __source: 'zoho_transactions' }))),
    ...((importedStatementAnchor?.transactions || []).map((row: any) => ({ ...row, __source: 'last_imported_statement' }))),
    ...((unreviewed || []).map((row: any) => ({ ...row, __source: 'zoho_uncategorized' }))),
  ];
  const unique = new Map<string, any>();
  rows.forEach((row: any, index: number) => {
    const key = bankTransactionId(row) || `${row.__source}:${index}:${bankTransactionFingerprint(row)}`;
    if (!unique.has(key)) unique.set(key, row);
  });
  return [...unique.values()];
};

async function begin(db: ReturnType<typeof svc>, key: string, action: string, userId: string, payload: unknown) {
  const { data: old } = await db.from('zoho_write_operations').select('id,status,result_payload')
    .eq('idempotency_key', key).maybeSingle();
  if (old?.status === 'succeeded') return { done: true, result: old.result_payload };
  if (old?.id) {
    await db.from('zoho_write_operations').update({ status: 'running', request_payload: payload,
      requested_by: userId, result_payload: {}, last_error: null, started_at: new Date().toISOString(), finished_at: null }).eq('id', old.id);
  } else {
    const { error } = await db.from('zoho_write_operations').insert({ idempotency_key: key, action,
      requested_by: userId, status: 'running', request_payload: payload });
    if (error) throw new Error(`audit_begin:${error.message}`);
  }
  return { done: false };
}

async function finish(db: ReturnType<typeof svc>, key: string, status: 'succeeded'|'failed'|'partial', result: unknown, error?: string) {
  await db.from('zoho_write_operations').update({ status, result_payload: result,
    last_error: error || null, finished_at: new Date().toISOString() }).eq('idempotency_key', key);
}

const firstArray = (...values: unknown[]) => values.find(Array.isArray) as any[] | undefined;
const normalizeUnreviewedBankTransaction = (row: any) => ({
  transaction_id: bankTransactionId(row),
  date: String(row?.date || row?.transaction_date || row?.value_date || '').slice(0, 10),
  reference: String(row?.reference_number || row?.reference || row?.reference_no || ''),
  description: String(row?.description || row?.narration || row?.details || row?.notes || ''),
  payee: String(row?.payee || row?.payee_name || row?.customer_name || row?.vendor_name || ''),
  amount: bankTransactionAmount(row),
  direction: bankTransactionDirection(row),
  status: String(row?.status || row?.transaction_status || 'unreviewed'),
});
const normalizeMatchCandidate = (row: any) => ({
  transaction_id: bankTransactionId(row),
  transaction_type: String(row?.transaction_type || row?.type || row?.entity_type || ''),
  date: String(row?.date || row?.transaction_date || '').slice(0, 10),
  reference: String(row?.reference_number || row?.reference || row?.number || ''),
  party: String(row?.customer_name || row?.vendor_name || row?.payee || row?.contact_name || ''),
  description: String(row?.description || row?.notes || row?.transaction_type_formatted || ''),
  amount: bankTransactionAmount(row),
});
const collectTransactionRows = (node: any, depth = 0): any[] => {
  if (node == null || depth > 8) return [];
  if (Array.isArray(node)) return node.flatMap(value => collectTransactionRows(value, depth + 1));
  if (typeof node !== 'object') return [];
  if (bankTransactionId(node) && (node.amount != null || node.total != null || node.transaction_amount != null
    || node.debit != null || node.credit != null || node.date || node.transaction_date || node.reference_number)) return [node];
  return Object.entries(node).filter(([key]) => !['page_context', 'consent_info'].includes(key))
    .flatMap(([, value]) => collectTransactionRows(value, depth + 1));
};

async function requireLiveZohoBank(db: ReturnType<typeof svc>, accountId: string) {
  if (!accountId) throw new Error('account_id_required');
  const { data, error } = await db.from('zoho_bank_accounts')
    .select('zoho_id,account_name,account_type,currency_code,status,uncategorized_count')
    .eq('zoho_id', accountId).maybeSingle();
  if (error) throw new Error(`bank_account_read:${error.message}`);
  if (!data || String(data.account_type || '').toLowerCase() !== 'bank') throw new Error('zoho_bank_account_not_found');
  if (/^\s*خزينة(?:\s|$)/i.test(String(data.account_name || ''))) throw new Error('treasury_is_not_a_bank');
  if (/moyassar|ميسر/i.test(String(data.account_name || ''))) throw new Error('payment_gateway_is_not_a_bank');
  return data;
}

async function loadZohoUnreviewed(
  access: { token: string; apiDomain: string; orgId: string },
  accountId: string,
  period: { start?: string; end?: string } = {},
) {
  const collected: any[] = [];
  let truncated = false;
  for (let page = 1; page <= ZOHO_BANK_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      organization_id: access.orgId,
      account_id: accountId,
      filter_by: 'Status.Uncategorized',
      page: String(page),
      per_page: String(ZOHO_BANK_PAGE_SIZE),
    });
    if (period.start) params.set('date_start', period.start);
    if (period.end) params.set('date_end', period.end);
    const url = `${access.apiDomain}/books/v3/banktransactions?${params.toString()}`;
    const z = await zjson(url, { method: 'GET', headers: { Authorization: `Zoho-oauthtoken ${access.token}` } });
    if (!z.r.ok || z.body?.code !== 0) throw new Error(`zoho_bank_unreviewed:${String(z.body?.message || z.r.status)}`);
    const rows = firstArray(z.body?.banktransactions, z.body?.transactions) || collectTransactionRows(z.body);
    collected.push(...rows);
    const context = z.body?.page_context || {};
    if (!context.has_more_page || !rows.length) break;
    if (page === ZOHO_BANK_MAX_PAGES) truncated = true;
  }
  if (truncated) throw new Error('zoho_bank_unreviewed_incomplete');
  const byId = new Map<string, ReturnType<typeof normalizeUnreviewedBankTransaction>>();
  collected.map(normalizeUnreviewedBankTransaction).filter(row => row.transaction_id)
    .forEach(row => byId.set(row.transaction_id, row));
  return [...byId.values()].sort((a, b) => b.date.localeCompare(a.date)
    || b.transaction_id.localeCompare(a.transaction_id));
}

const openingBalance = (s: unknown) => String(s || '').replace(/\s+/g, ' ').trim()
  .includes('\u0627\u0644\u0631\u0635\u064a\u062f \u0627\u0644\u0627\u0641\u062a\u062a\u0627\u062d\u064a');

const liveEinvoiceStatus = (invoice: Record<string, unknown>) => {
  const details = invoice.einvoice_details && typeof invoice.einvoice_details === 'object'
    ? invoice.einvoice_details as Record<string, unknown>
    : {};
  return String(details.status || invoice.einvoice_status || invoice.e_invoice_status || '').toLowerCase();
};

async function getLiveInvoice(access: { token: string; apiDomain: string; orgId: string }, invoiceId: string) {
  const url = `${access.apiDomain}/books/v3/invoices/${encodeURIComponent(invoiceId)}?organization_id=${encodeURIComponent(access.orgId)}`;
  const z = await zjson(url, { method: 'GET', headers: { Authorization: `Zoho-oauthtoken ${access.token}` } });
  if (!z.r.ok || z.body?.code !== 0 || !z.body?.invoice) {
    throw new Error(`zoho_invoice_read:${String(z.body?.message || z.r.status)}`);
  }
  return z.body.invoice as Record<string, unknown>;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const db = svc();
  let input: any = {};
  try { input = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const action = String(input.action || '');
  const permissionByAction: Record<string, string> = {
    bank_preview: 'zoho.bank_import',
    bank_export_record: 'zoho.bank_import',
    bank_export_verify: 'zoho.bank_import',
    bank_import: 'zoho.bank_import',
    bank_unreviewed_list: 'bank.view',
    bank_match_candidates: 'bank.view',
    bank_match_approve: 'zoho.bank_match',
    invoice_mark_sent: 'zoho.invoice_mark_sent',
    invoice_push_zatca: 'zoho.invoice_push_zatca',
    invoice_finalize_and_push_zatca: 'zoho.invoice_mark_sent',
    webhook_failures: 'zoho.retry_webhook',
    webhook_retry: 'zoho.retry_webhook',
  };
  const requiredPermission = permissionByAction[action];
  if (!requiredPermission) return json({ error: 'unknown_action' }, 400);
  const requiredPermissions = action === 'invoice_finalize_and_push_zatca'
    ? ['zoho.invoice_mark_sent', 'zoho.invoice_push_zatca']
    : [requiredPermission];
  const user = requiredPermissions.length === 1
    ? await requirePermission(req, db, requiredPermission)
    : await requirePermissions(req, db, requiredPermissions);
  if (!user) return json({ error: 'forbidden', permissions: requiredPermissions }, 403);

  try {
    if (action === 'bank_unreviewed_list' || action === 'bank_match_candidates' || action === 'bank_match_approve') {
      const accountId = String(input.account_id || '');
      const account = await requireLiveZohoBank(db, accountId);
      const access = await accessToken(db);
      const unreviewed = await loadZohoUnreviewed(access, accountId);

      if (action === 'bank_unreviewed_list') return json({
        ok: true,
        account: {
          zoho_id: account.zoho_id,
          account_name: account.account_name,
          currency: account.currency_code,
          status: account.status,
          mirror_count: Number(account.uncategorized_count || 0),
        },
        count: unreviewed.length,
        deposits: unreviewed.filter(row => row.direction === 'credit').reduce((sum, row) => sum + row.amount, 0),
        withdrawals: unreviewed.filter(row => row.direction === 'debit').reduce((sum, row) => sum + row.amount, 0),
        transactions: unreviewed,
        fetched_at: new Date().toISOString(),
      });

      const transactionId = String(input.transaction_id || '');
      const source = unreviewed.find(row => row.transaction_id === transactionId);
      if (!source) return json({ error: 'unreviewed_transaction_not_found_for_account' }, 404);

      if (action === 'bank_match_candidates') {
        const url = `${access.apiDomain}/books/v3/banktransactions/uncategorized/${encodeURIComponent(transactionId)}/match?organization_id=${encodeURIComponent(access.orgId)}`;
        const z = await zjson(url, { method: 'GET', headers: { Authorization: `Zoho-oauthtoken ${access.token}` } });
        if (!z.r.ok || z.body?.code !== 0) return json({ error: String(z.body?.message || z.r.status) }, 400);
        const rows = firstArray(z.body?.matching_transactions, z.body?.transactions,
          z.body?.banktransactions, z.body?.matches) || [];
        const candidates = rows.map(normalizeMatchCandidate)
          .filter(row => row.transaction_id && row.transaction_type);
        return json({ ok: true, account_id: accountId, source, candidates });
      }

      const matchId = String(input.match_transaction_id || '');
      const matchType = String(input.match_transaction_type || '');
      if (!matchId || !matchType) return json({ error: 'explicit_match_required' }, 400);
      const key = `bank_match:${accountId}:${transactionId}:${matchType}:${matchId}`;
      const requestPayload = { account_id: accountId, transaction_id: transactionId,
        match_transaction_id: matchId, match_transaction_type: matchType };
      const audit = await begin(db, key, 'bank_transaction_match', user.id, requestPayload);
      if (audit.done) return json({ ok: true, idempotent: true, result: audit.result });
      const url = `${access.apiDomain}/books/v3/banktransactions/uncategorized/${encodeURIComponent(transactionId)}/match?organization_id=${encodeURIComponent(access.orgId)}`;
      const payload = { transactions_to_be_matched: [{ transaction_id: matchId, transaction_type: matchType }] };
      const z = await zjson(url, { method: 'POST', headers: {
        Authorization: `Zoho-oauthtoken ${access.token}`, 'Content-Type': 'application/json',
      }, body: JSON.stringify(payload) });
      if (!z.r.ok || z.body?.code !== 0) {
        const message = String(z.body?.message || z.r.status);
        await finish(db, key, 'failed', z.body, message);
        return json({ error: message, needs_reauthorization: /authori|scope|permission/i.test(message) }, 400);
      }
      const result = { account_id: accountId, transaction_id: transactionId,
        matched_transaction_id: matchId, matched_transaction_type: matchType, zoho: z.body };
      await finish(db, key, 'succeeded', result);
      return json({ ok: true, ...result });
    }

    if (action === 'bank_import') return json({
      error: 'bank_import_disabled_manual_zoho_upload',
      message: 'تم إيقاف ترحيل كشوف البنوك من النظام. نزّل ملف العمليات الناقصة وارفعه يدويًا في Zoho.',
    }, 410);

    if (action === 'bank_export_record') {
      const accountId = String(input.account_id || '');
      const fileName = String(input.file_name || '').trim().slice(0, 180);
      const transactionIds = [...new Set((input.transaction_ids || []).map(String))].slice(0, 1000).sort();
      if (!fileName || !transactionIds.length) return json({ error: 'file_name_and_transaction_ids_required' }, 400);
      await requireLiveZohoBank(db, accountId);
      const { data: link, error: linkError } = await db.from('zoho_financial_account_links')
        .select('zoho_account_id,internal_bank_name,link_kind').eq('zoho_account_id', accountId).maybeSingle();
      if (linkError) throw new Error(`bank_link_read:${linkError.message}`);
      if (!link?.internal_bank_name || link.link_kind !== 'bank') return json({ error: 'bank_account_not_linked' }, 400);

      const rows: any[] = [];
      for (let offset = 0; offset < transactionIds.length; offset += 180) {
        const { data, error } = await db.from('bank_transactions')
          .select('id,txn_date,txn_at,reference,description,debit,credit,bank')
          .eq('bank', link.internal_bank_name).in('id', transactionIds.slice(offset, offset + 180));
        if (error) throw new Error(`bank_export_rows_read:${error.message}`);
        rows.push(...(data || []));
      }
      if (rows.length !== transactionIds.length) return json({
        error: 'bank_export_scope_mismatch', expected: transactionIds.length, found: rows.length,
      }, 400);
      const invalid = rows.filter(row => !(Number(row.debit) > 0 || Number(row.credit) > 0)
        || !/^\d{4}-\d{2}-\d{2}$/.test(localTxnDate(row)));
      if (invalid.length) return json({ error: 'bank_export_contains_invalid_rows', count: invalid.length }, 400);

      const idempotencyKey = await sha256(`${accountId}|${transactionIds.join(',')}`);
      const { data: existing } = await db.from('zoho_bank_export_batches').select('*')
        .eq('idempotency_key', idempotencyKey).maybeSingle();
      if (existing) {
        const { data: existingItems, error: existingItemsError } = await db.from('zoho_bank_export_items').select('*')
          .eq('batch_id', existing.id).order('transaction_date', { ascending: true });
        if (existingItemsError) throw new Error(`bank_export_items_read:${existingItemsError.message}`);
        return json({ ok: true, idempotent: true, batch: exportBatchView(existing, existingItems || []) });
      }

      const { data: batch, error: batchError } = await db.from('zoho_bank_export_batches').insert({
        zoho_account_id: accountId,
        internal_bank_name: link.internal_bank_name,
        idempotency_key: idempotencyKey,
        file_name: fileName,
        row_count: rows.length,
        exported_by: user.id,
      }).select('*').single();
      if (batchError) throw new Error(`bank_export_batch_write:${batchError.message}`);
      const items = rows.map(row => ({
        batch_id: batch.id,
        bank_transaction_id: row.id,
        reference_number: String(row.reference || ''),
        transaction_date: localTxnDate(row),
        direction: Number(row.credit) > 0 ? 'credit' : 'debit',
        amount: Number(row.credit) > 0 ? Number(row.credit) : Number(row.debit),
        fingerprint: bankTransactionFingerprint(row),
      }));
      const { error: itemsError } = await db.from('zoho_bank_export_items').insert(items);
      if (itemsError) throw new Error(`bank_export_items_write:${itemsError.message}`);
      for (let offset = 0; offset < transactionIds.length; offset += 180) {
        const { error } = await db.from('bank_transactions').update({
          zoho_import_status: 'exported_for_manual_upload', zoho_bank_account_id: accountId,
        }).in('id', transactionIds.slice(offset, offset + 180));
        if (error) throw new Error(`bank_export_status_write:${error.message}`);
      }
      return json({ ok: true, batch: exportBatchView(batch, items) });
    }

    if (action === 'bank_export_verify') {
      const accountId = String(input.account_id || '');
      const requestedBatchId = String(input.batch_id || '');
      await requireLiveZohoBank(db, accountId);
      let batchQuery = db.from('zoho_bank_export_batches').select('*').eq('zoho_account_id', accountId);
      batchQuery = requestedBatchId ? batchQuery.eq('id', requestedBatchId)
        : batchQuery.order('exported_at', { ascending: false }).limit(1);
      const { data: batch, error: batchError } = await batchQuery.maybeSingle();
      if (batchError) throw new Error(`bank_export_batch_read:${batchError.message}`);
      if (!batch) return json({ error: 'bank_export_batch_not_found' }, 404);
      const { data: items, error: itemsError } = await db.from('zoho_bank_export_items').select('*')
        .eq('batch_id', batch.id).order('transaction_date', { ascending: true });
      if (itemsError) throw new Error(`bank_export_items_read:${itemsError.message}`);

      const access = await accessToken(db);
      const [liveAnchor, importedStatementAnchor, unreviewed] = await Promise.all([
        liveZohoBankTransactionSnapshot(access, accountId),
        lastImportedBankAnchor(access, accountId),
        loadZohoUnreviewed(access, accountId),
      ]);
      const inventory = verificationInventory(liveAnchor, importedStatementAnchor, unreviewed);
      const byReference = new Map<string, any[]>();
      const byFingerprint = new Map<string, any[]>();
      inventory.forEach(row => {
        const reference = normalizedRef(row.reference_number || row.reference);
        const fingerprint = bankTransactionFingerprint(row);
        if (reference) byReference.set(reference, [...(byReference.get(reference) || []), row]);
        if (fingerprint) byFingerprint.set(fingerprint, [...(byFingerprint.get(fingerprint) || []), row]);
      });

      const verifiedAt = new Date().toISOString();
      const updates = (items || []).map(item => {
        const reference = normalizedRef(item.reference_number);
        let candidates = reference ? (byReference.get(reference) || []) : [];
        let matchMethod: 'reference'|'fingerprint'|null = candidates.length ? 'reference' : null;
        if (!candidates.length && item.fingerprint) {
          candidates = byFingerprint.get(String(item.fingerprint)) || [];
          if (candidates.length) matchMethod = 'fingerprint';
        }
        const status = candidates.length === 1 ? 'seen_in_zoho' : candidates.length > 1 ? 'duplicate' : 'missing';
        const candidate = candidates[0] || null;
        return {
          id: item.id,
          batch_id: batch.id,
          bank_transaction_id: item.bank_transaction_id,
          reference_number: item.reference_number,
          transaction_date: item.transaction_date,
          direction: item.direction,
          amount: item.amount,
          fingerprint: item.fingerprint,
          status,
          zoho_transaction_id: candidate ? bankTransactionId(candidate) || null : null,
          match_method: matchMethod,
          verified_at: verifiedAt,
          verification_details: { candidate_count: candidates.length, source: candidate?.__source || null },
        };
      });
      const { error: updateError } = await db.from('zoho_bank_export_items').upsert(updates, { onConflict: 'id' });
      if (updateError) throw new Error(`bank_export_items_verify:${updateError.message}`);
      for (const status of ['seen_in_zoho', 'missing', 'duplicate']) {
        const ids = updates.filter(item => item.status === status).map(item => item.bank_transaction_id);
        for (let offset = 0; offset < ids.length; offset += 180) {
          const { error } = await db.from('bank_transactions').update({
            zoho_import_status: status, zoho_bank_account_id: accountId,
          }).in('id', ids.slice(offset, offset + 180));
          if (error) throw new Error(`bank_export_status_verify:${error.message}`);
        }
      }
      const seenCount = updates.filter(item => item.status === 'seen_in_zoho').length;
      const missingCount = updates.filter(item => item.status === 'missing').length;
      const duplicateCount = updates.filter(item => item.status === 'duplicate').length;
      const status = missingCount === 0 && duplicateCount === 0 ? 'verified'
        : seenCount > 0 ? 'partial' : 'needs_review';
      const summary = { checked_in_zoho: inventory.length, verified_at: verifiedAt };
      const { data: savedBatch, error: saveError } = await db.from('zoho_bank_export_batches').update({
        status, seen_count: seenCount, missing_count: missingCount, duplicate_count: duplicateCount,
        last_verified_at: verifiedAt, verification_summary: summary, updated_at: verifiedAt,
      }).eq('id', batch.id).select('*').single();
      if (saveError) throw new Error(`bank_export_batch_verify:${saveError.message}`);
      return json({ ok: status === 'verified', batch: exportBatchView(savedBatch, updates) });
    }

    if (action === 'bank_preview') {
      const accountId = String(input.account_id || '');
      const { data: link } = await db.from('zoho_financial_account_links')
        .select('zoho_account_id,internal_bank_name,link_kind').eq('zoho_account_id', accountId).maybeSingle();
      if (!link?.internal_bank_name || link.link_kind !== 'bank') return json({ error: 'bank_account_not_linked' }, 400);
      const txs = await loadAllLocalBankTransactions(db, link.internal_bank_name);
      const ordered = [...(txs || [])].sort((a: any, b: any) => localTxnDate(a).localeCompare(localTxnDate(b))
        || String(a.id).localeCompare(String(b.id)));
      const localPeriod = {
        start: ordered.length ? localTxnDate(ordered[0]) : '',
        end: ordered.length ? localTxnDate(ordered[ordered.length - 1]) : '',
      };
      const access = await accessToken(db);
      const { data: manualAnchor } = await db.from('zoho_bank_import_anchors')
        .select('reference_number,anchor_date,local_transaction_id').eq('zoho_account_id', accountId).maybeSingle();
      const [liveAnchor, importedStatementAnchor, unreviewed] = await Promise.all([
        liveZohoBankTransactionSnapshot(access, accountId, localPeriod),
        lastImportedBankAnchor(access, accountId),
        loadZohoUnreviewed(access, accountId, localPeriod),
      ]);
      const unreviewedOrdered = [...unreviewed].sort((a, b) => a.date.localeCompare(b.date)
        || a.transaction_id.localeCompare(b.transaction_id));
      const lastUnreviewed = unreviewedOrdered.at(-1);
      const unreviewedAnchor = lastUnreviewed ? {
        date: lastUnreviewed.date,
        reference: lastUnreviewed.reference,
        transactionId: lastUnreviewed.transaction_id,
        statementId: '', source: 'zoho_uncategorized', count: unreviewedOrdered.length,
        knownReferences: new Set(unreviewedOrdered.map(row => normalizedRef(row.reference)).filter(Boolean)),
        knownTransactionIds: new Set(unreviewedOrdered.map(row => row.transaction_id).filter(Boolean)),
        knownFingerprints: new Set(unreviewedOrdered.map(bankTransactionFingerprint).filter(Boolean)),
      } : null;
      const manualFallback = manualAnchor ? {
        date: String(manualAnchor.anchor_date || '').slice(0, 10),
        reference: String(manualAnchor.reference_number || ''),
        transactionId: '', statementId: '', source: 'manual_reference',
        knownReferences: new Set([normalizedRef(manualAnchor.reference_number)].filter(Boolean)),
        knownTransactionIds: new Set<string>(),
        knownFingerprints: new Set<string>(),
      } : null;
      const liveProofCandidates: any[] = [liveAnchor, unreviewedAnchor].filter(Boolean);
      const informationalCandidates: any[] = [...liveProofCandidates, importedStatementAnchor].filter(Boolean);
      const anchor = informationalCandidates.sort((a, b) => a.date.localeCompare(b.date)
        || a.transactionId.localeCompare(b.transactionId)).at(-1) || manualFallback;
      const zohoKnownReferences = new Set<string>();
      const zohoKnownTransactionIds = new Set<string>();
      const zohoKnownFingerprints = new Set<string>();
      // Only current Zoho transactions and the current unreviewed queue prove
      // that a local statement row still exists in Zoho. The last imported
      // statement endpoint is an historical receipt and can keep rows that
      // were later deleted or rejected, so it must never suppress an export.
      for (const candidate of liveProofCandidates) {
        candidate.knownReferences.forEach((reference: string) => zohoKnownReferences.add(reference));
        candidate.knownTransactionIds.forEach((transactionId: string) => zohoKnownTransactionIds.add(transactionId));
        candidate.knownFingerprints.forEach((fingerprint: string) => zohoKnownFingerprints.add(fingerprint));
      }
      // The anchor is informational only. Using it as a cut-off hid historical gaps.
      // Compare the complete local period with Zoho and exclude only proven matches.
      const candidates = ordered;
      const anchorMatchedLocally = Boolean(anchor && ordered.some((t: any) =>
        (anchor.transactionId && String(t.dedup_key || '') === anchor.transactionId)
        || (anchor.reference && normalizedRef(t.reference) === normalizedRef(anchor.reference))));
      let liveTransactionExcluded = 0;
      let referenceExcluded = 0;
      let fingerprintExcluded = 0;
      let invalidExcluded = 0;
      const fresh = candidates.filter((t: any) => {
        if (!(Number(t.debit) > 0 || Number(t.credit) > 0)) { invalidExcluded += 1; return false; }
        if (zohoKnownTransactionIds.has(String(t.dedup_key || ''))) {
          liveTransactionExcluded += 1; return false;
        }
        const reference = normalizedRef(t.reference);
        if (reference && zohoKnownReferences.has(reference)) { referenceExcluded += 1; return false; }
        const fingerprint = bankTransactionFingerprint(t);
        if (fingerprint && zohoKnownFingerprints.has(fingerprint)) { fingerprintExcluded += 1; return false; }
        return true;
      });
      const latestExport = await latestBankExportBatch(db, accountId);
      const zohoInventoryCount = verificationInventory(liveAnchor, importedStatementAnchor, unreviewed).length;
      const summary = { account_id: accountId, bank: link.internal_bank_name, count: fresh.length,
        deposits: fresh.reduce((s: number, t: any) => s + Number(t.credit || 0), 0),
        withdrawals: fresh.reduce((s: number, t: any) => s + Number(t.debit || 0), 0),
        duplicates: liveTransactionExcluded + referenceExcluded + fingerprintExcluded,
        comparison_mode: 'full_history',
        local_period_from: localPeriod.start || null,
        local_period_to: localPeriod.end || null,
        local_scanned: ordered.length,
        history_excluded: 0,
        prior_import_excluded: 0,
        live_transaction_excluded: liveTransactionExcluded,
        reference_excluded: referenceExcluded,
        fingerprint_excluded: fingerprintExcluded,
        invalid_excluded: invalidExcluded,
        zoho_anchor: anchor ? { date: anchor.date, reference: anchor.reference,
          transaction_id: anchor.transactionId, statement_id: anchor.statementId,
          matched_locally: anchorMatchedLocally, source: anchor.source || 'last_imported_statement' } : null,
        zoho_known_count: Math.max(zohoKnownReferences.size, zohoKnownTransactionIds.size, zohoKnownFingerprints.size),
        zoho_checked_count: zohoInventoryCount,
        imported_statement_is_informational: Boolean(importedStatementAnchor),
        manual_anchor_ignored: Boolean(manualAnchor && informationalCandidates.length),
        anchor_required: false,
        latest_export: latestExport,
        transactions: fresh.map((t: any) => ({ id: t.id, date: String(t.txn_at || t.txn_date || '').slice(0, 10),
          reference: t.reference, description: t.description, debit: Number(t.debit || 0), credit: Number(t.credit || 0) })) };
      return json({ ok: true, read_only: true, upload_mode: 'manual_zoho_excel', ...summary });
    }

    if (action === 'invoice_finalize_and_push_zatca') {
      const ids: string[] = [...new Set<string>((input.invoice_ids || []).map(String))].slice(0, 100);
      if (!ids.length) return json({ error: 'invoice_ids_required' }, 400);
      const { data: invoices, error } = await db.from('zoho_invoices')
        .select('zoho_id,invoice_number,customer_name,date,total,status,einvoice_status').in('zoho_id', ids);
      if (error) throw new Error(`invoice_read:${error.message}`);
      const byId = new Map((invoices || []).map((invoice: any) => [String(invoice.zoho_id), invoice]));
      const access = await accessToken(db);
      const headers = { Authorization: `Zoho-oauthtoken ${access.token}` };
      const results: any[] = [];

      const processInvoice = async (invoiceId: string) => {
        const inv: any = byId.get(invoiceId);
        if (!inv) {
          return { invoice_id: invoiceId, outcome: 'failed', stage: 'read', error: 'invoice_not_found_in_mirror' };
        }
        if (openingBalance(inv.invoice_number)) {
          return { invoice_id: inv.zoho_id, number: inv.invoice_number, outcome: 'excluded', reason: 'opening_balance' };
        }

        let live: Record<string, unknown>;
        try {
          live = await getLiveInvoice(access, String(inv.zoho_id));
        } catch (error) {
          return { invoice_id: inv.zoho_id, number: inv.invoice_number, outcome: 'failed', stage: 'live_check',
            error: error instanceof Error ? error.message : String(error) };
        }

        let liveDocumentStatus = String(live.status || inv.status || '').toLowerCase();
        let liveZatcaStatus = liveEinvoiceStatus(live);
        let markedSent = liveDocumentStatus !== 'draft';
        let pushed = false;

        if (['pushed', 'reported', 'cleared'].includes(liveZatcaStatus)) {
          await db.from('zoho_invoices').update({ status: liveDocumentStatus || 'sent', einvoice_status: liveZatcaStatus }).eq('zoho_id', inv.zoho_id);
          return { invoice_id: inv.zoho_id, number: inv.invoice_number, outcome: 'succeeded',
            marked_sent: markedSent, pushed: false, reason: 'already_pushed', live_zatca_status: liveZatcaStatus };
        }
        if (liveZatcaStatus !== 'yet_to_be_pushed') {
          return { invoice_id: inv.zoho_id, number: inv.invoice_number, outcome: 'failed', stage: 'readiness',
            marked_sent: markedSent, error: `zatca_not_ready:${liveZatcaStatus || 'status_unavailable'}` };
        }

        const pushKey = `zatca_push:${inv.zoho_id}`;
        const audit = await begin(db, pushKey, 'invoice_push_zatca', user.id,
          { invoice_id: inv.zoho_id, invoice_number: inv.invoice_number, parent_action: action });
        if (!audit.done) {
          const pushUrl = `${access.apiDomain}/books/v3/invoices/${inv.zoho_id}/einvoice/push?organization_id=${encodeURIComponent(access.orgId)}`;
          const pushedResponse = await zjson(pushUrl, { method: 'POST', headers }, { retryPortal: true, timeoutMs: 15_000 });
          if (!pushedResponse.r.ok || pushedResponse.body?.code !== 0) {
            const message = String(pushedResponse.body?.message || pushedResponse.r.status);
            await finish(db, pushKey, 'failed', pushedResponse.body, message);
            return { invoice_id: inv.zoho_id, number: inv.invoice_number, outcome: 'failed', stage: 'zatca_push',
              marked_sent: markedSent, retryable: [41051, -1, 503, 504].includes(Number(pushedResponse.body?.code))
                || /503|temporar|proxy|مؤقت/i.test(message),
              error: message };
          }
          await finish(db, pushKey, 'succeeded', pushedResponse.body);
        }
        pushed = true;

        // Saudi e-invoices cannot be marked sent before they are submitted to
        // Fatoora (Zoho code 41016). Push first, then re-read the live document.
        let postPushWarning = '';
        for (let attempt = 0; attempt < 4; attempt += 1) {
          if (attempt) await new Promise(resolve => setTimeout(resolve, 700));
          try {
            live = await getLiveInvoice(access, String(inv.zoho_id));
            liveDocumentStatus = String(live.status || liveDocumentStatus).toLowerCase();
            liveZatcaStatus = liveEinvoiceStatus(live) || 'pushed';
            if (['pushed', 'reported', 'cleared'].includes(liveZatcaStatus)) break;
          } catch (error) {
            postPushWarning = error instanceof Error ? error.message : String(error);
          }
        }

        if (liveDocumentStatus === 'draft') {
          const markKey = `mark_sent:${inv.zoho_id}`;
          const markAudit = await begin(db, markKey, 'invoice_mark_sent', user.id,
            { invoice_id: inv.zoho_id, invoice_number: inv.invoice_number, parent_action: action, after_zatca_push: true });
          if (!markAudit.done) {
            const markUrl = `${access.apiDomain}/books/v3/invoices/${inv.zoho_id}/status/sent?organization_id=${encodeURIComponent(access.orgId)}`;
            const marked = await zjson(markUrl, { method: 'POST', headers });
            if (!marked.r.ok || marked.body?.code !== 0) {
              postPushWarning = String(marked.body?.message || marked.r.status);
              await finish(db, markKey, 'failed', marked.body, postPushWarning);
            } else {
              await finish(db, markKey, 'succeeded', marked.body);
              liveDocumentStatus = 'sent';
              markedSent = true;
            }
          } else {
            liveDocumentStatus = 'sent';
            markedSent = true;
          }
        } else {
          markedSent = true;
        }

        await db.from('zoho_invoices').update({ status: liveDocumentStatus || inv.status,
          einvoice_status: ['pushed', 'reported', 'cleared'].includes(liveZatcaStatus) ? liveZatcaStatus : 'pushed' })
          .eq('zoho_id', inv.zoho_id);
        return { invoice_id: inv.zoho_id, number: inv.invoice_number, outcome: 'succeeded',
          marked_sent: markedSent, pushed, warning: postPushWarning || undefined,
          message: markedSent ? 'pushed_and_marked_sent' : 'pushed' };
      };

      // Two invoices at a time keep the request bounded without flooding Zoho's
      // Fatoora gateway. Results are restored to the user's selection order.
      for (let offset = 0; offset < ids.length; offset += 2) {
        const chunk = ids.slice(offset, offset + 2);
        results.push(...await Promise.all(chunk.map(processInvoice)));
      }

      const failed = results.filter(result => result.outcome === 'failed').length;
      const succeeded = results.filter(result => result.outcome === 'succeeded').length;
      const skipped = results.filter(result => ['skipped', 'excluded'].includes(result.outcome)).length;
      return json({ ok: failed === 0, succeeded, skipped, failed, results }, failed ? 207 : 200);
    }

    if (action === 'invoice_mark_sent' || action === 'invoice_push_zatca') {
      const ids = [...new Set((input.invoice_ids || []).map(String))].slice(0, 100);
      if (!ids.length) return json({ error: 'invoice_ids_required' }, 400);
      const { data: invoices, error } = await db.from('zoho_invoices')
        .select('zoho_id,invoice_number,customer_name,date,total,status,einvoice_status').in('zoho_id', ids);
      if (error) throw new Error(`invoice_read:${error.message}`);
      const access = await accessToken(db);
      const headers = { Authorization: `Zoho-oauthtoken ${access.token}` };
      const results: any[] = [];
      for (const inv of invoices || []) {
        if (action === 'invoice_mark_sent' && String(inv.status).toLowerCase() !== 'draft') {
          results.push({ invoice_id: inv.zoho_id, number: inv.invoice_number, outcome: 'skipped', reason: 'not_draft' }); continue;
        }
        if (action === 'invoice_push_zatca' && openingBalance(inv.invoice_number)) {
          results.push({ invoice_id: inv.zoho_id, number: inv.invoice_number, outcome: 'excluded', reason: 'opening_balance' }); continue;
        }
        if (action === 'invoice_push_zatca' && String(inv.einvoice_status).toLowerCase() !== 'yet_to_be_pushed') {
          results.push({ invoice_id: inv.zoho_id, number: inv.invoice_number, outcome: 'skipped', reason: 'not_pending_zatca' }); continue;
        }
        const op = action === 'invoice_mark_sent' ? 'mark_sent' : 'zatca_push';
        const key = `${op}:${inv.zoho_id}`;
        const audit = await begin(db, key, action, user.id, { invoice_id: inv.zoho_id, invoice_number: inv.invoice_number });
        if (audit.done) { results.push({ invoice_id: inv.zoho_id, number: inv.invoice_number, outcome: 'skipped', reason: 'already_done' }); continue; }
        const path = action === 'invoice_mark_sent' ? `status/sent` : 'einvoice/push';
        const url = `${access.apiDomain}/books/v3/invoices/${inv.zoho_id}/${path}?organization_id=${encodeURIComponent(access.orgId)}`;
        const z = await zjson(url, { method: 'POST', headers });
        if (!z.r.ok || z.body.code !== 0) {
          const msg = String(z.body.message || z.r.status); await finish(db, key, 'failed', z.body, msg);
          results.push({ invoice_id: inv.zoho_id, number: inv.invoice_number, outcome: 'failed', error: msg });
        } else {
          await finish(db, key, 'succeeded', z.body);
          if (action === 'invoice_mark_sent') await db.from('zoho_invoices').update({ status: 'sent' }).eq('zoho_id', inv.zoho_id);
          results.push({ invoice_id: inv.zoho_id, number: inv.invoice_number, outcome: 'succeeded', message: z.body.message });
        }
      }
      const failed = results.filter(x => x.outcome === 'failed').length;
      return json({ ok: failed === 0, succeeded: results.filter(x => x.outcome === 'succeeded').length,
        skipped: results.filter(x => ['skipped','excluded'].includes(x.outcome)).length, failed, results }, failed ? 207 : 200);
    }

    if (action === 'webhook_failures') {
      const { data, error } = await db.from('zoho_webhook_inbox')
        .select('event_key,event_type,entity_type,entity_id,status,attempts,received_at,last_error')
        .in('status', ['failed','processing']).order('received_at', { ascending: false }).limit(100);
      if (error) throw new Error(error.message);
      return json({ ok: true, rows: data || [] });
    }
    if (action === 'webhook_retry') {
      const key = String(input.event_key || '');
      const { data: event } = await db.from('zoho_webhook_inbox').select('entity_type,entity_id,attempts').eq('event_key', key).maybeSingle();
      if (!event?.entity_id) return json({ error: 'event_not_found' }, 404);
      // A targeted mirror refresh is safer than replaying an untrusted raw payload.
      await db.from('zoho_webhook_inbox').update({ status: 'processing', attempts: Number(event.attempts || 0) + 1,
        processing_started_at: new Date().toISOString(), last_error: null }).eq('event_key', key);
      const sync = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/zoho-sync`, {
        method: 'POST', headers: { Authorization: req.headers.get('Authorization') || '',
          apikey: Deno.env.get('SUPABASE_ANON_KEY')!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync', force: true }),
      });
      const syncBody = await sync.json().catch(() => ({}));
      const ok = sync.ok && syncBody?.ok !== false;
      await db.from('zoho_webhook_inbox').update({ status: ok ? 'processed' : 'failed',
        processed_at: ok ? new Date().toISOString() : null,
        last_error: ok ? null : String(syncBody?.error || sync.status) }).eq('event_key', key);
      return json({ ok, entity_type: event.entity_type, entity_id: event.entity_id, sync: syncBody }, ok ? 200 : 502);
    }
    return json({ error: 'unknown_action' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ scope: 'zoho-operations', action, message }));
    return json({ error: message }, 500);
  }
});
