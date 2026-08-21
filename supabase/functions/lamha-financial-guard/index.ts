import { createClient } from 'npm:@supabase/supabase-js@2';
import { waitForLamhaApiSlot } from '../_shared/lamhaRateLimit.ts';
import {
  buildFinancialGuardRows,
  extractLamhaStorePage,
  financialGuardDecision,
  LAMHA_FINANCIAL_GUARD_KEY,
  normalizeLamhaStoreRow,
  parseLamhaAccountActive,
} from '../_shared/lamhaFinancialGuard.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const LAMHA_BASE = (Deno.env.get('LAMHA_EMPLOYEE_API_BASE') || 'https://lamha-dev.phphubx.com/api/v1').replace(/\/$/, '');
const DIRECTORY_PAGE_SIZE = 50;
const MAX_DIRECTORY_PAGES = 100;
const MAX_CHANGES_PER_POLICY_RUN = 10;
const AUTOMATION_ENABLED = (Deno.env.get('LAMHA_FINANCIAL_GUARD_EXECUTION_ENABLED') || '').toLowerCase() === 'true';

type Db = ReturnType<typeof createClient>;
type Json = Record<string, unknown>;

const TRUSTED_ORIGINS = new Set([
  'https://shipaudit-five.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function cors(req: Request) {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': TRUSTED_ORIGINS.has(origin) ? origin : 'https://shipaudit-five.vercel.app',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function response(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function riyadhDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

async function sha256(value: unknown) {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function safeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

async function authorize(req: Request) {
  const configuredCronKey = (Deno.env.get('LAMHA_FINANCIAL_GUARD_CRON_SECRET') || '').trim();
  const suppliedCronKey = (req.headers.get('x-cron-key') || '').trim();
  if (configuredCronKey && suppliedCronKey && safeEqual(configuredCronKey, suppliedCronKey)) {
    return { kind: 'cron' as const, userId: null };
  }

  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return null;
  const { data: auth, error } = await db.auth.getUser(jwt);
  if (error || !auth.user) return null;
  const { data: profile } = await db.from('profiles').select('role').eq('id', auth.user.id).maybeSingle();
  return profile?.role === 'admin' ? { kind: 'admin' as const, userId: auth.user.id } : null;
}

async function lamhaFetch(token: string, path: string, init: RequestInit = {}) {
  await waitForLamhaApiSlot(db, token, `lamha-financial-guard:${init.method || 'GET'}:${path.split('?')[0]}`, 75_000);
  const result = await fetch(`${LAMHA_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await result.json().catch(() => ({}));
  return { ok: result.ok, status: result.status, payload };
}

function nestedStoreRecords(payload: unknown): Json[] {
  const queue: unknown[] = [payload];
  const seen = new Set<object>();
  const records: Json[] = [];
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current as object)) continue;
    seen.add(current as object);
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    const record = current as Json;
    records.push(record);
    queue.push(...Object.values(record));
  }
  return records;
}

function liveStoreSummary(payload: unknown, storeId: number) {
  const records = nestedStoreRecords(payload);
  const storeIdOf = (record: Json) => Number(
    record.id ?? record.store_id ?? record.storeId ?? record.business_id ?? record.businessId,
  ) || null;
  const identity = records.find(record => storeIdOf(record) === storeId)
    || records.find(record => storeIdOf(record) != null)
    || {};
  const hasOperationalField = (record: Json) => (
    ['is_active', 'isActive', 'account_active', 'accountActive'].some(key => Object.hasOwn(record, key))
  );
  const operational = records.find(record => storeIdOf(record) === storeId && hasOperationalField(record))
    || records.find(hasOperationalField)
    || identity;
  const record = { ...identity, ...operational };
  const status = record.status ?? record.store_status ?? record.storeStatus ?? record.lifecycle_status;
  const explicit = record.is_active ?? record.isActive ?? record.account_active ?? record.accountActive;
  return {
    id: storeIdOf(identity),
    name: String(record.name ?? record.store_name ?? record.storeName ?? '') || null,
    status: typeof status === 'object' ? String((status as Json).label ?? (status as Json).name ?? (status as Json).value ?? '') : String(status ?? ''),
    active: typeof explicit === 'boolean' ? explicit : parseLamhaAccountActive(explicit, status),
  };
}

async function latestMerchantRows() {
  const { data: marker, error: markerError } = await db.from('merchants')
    .select('snapshot_id,uploaded_at').order('uploaded_at', { ascending: false }).limit(1).maybeSingle();
  if (markerError) throw new Error(`merchant_snapshot_marker_failed:${markerError.message}`);
  if (!marker?.snapshot_id) return { rows: [] as Json[], snapshot: null };
  const { data, error } = await db.from('merchants').select('*').eq('snapshot_id', marker.snapshot_id);
  if (error) throw new Error(`merchant_snapshot_read_failed:${error.message}`);
  return { rows: (data || []) as Json[], snapshot: marker };
}

async function syncDirectory(token: string, actorId: string | null) {
  const previous = await latestMerchantRows();
  const previousByStore = new Map(previous.rows.map(row => [String(row.store_id), row]));
  const rawRows: Json[] = [];
  let page = 1;
  let lastPage = 1;

  do {
    const result = await lamhaFetch(token, `/stores?page=${page}&per_page=${DIRECTORY_PAGE_SIZE}`);
    if (!result.ok) throw new Error(`lamha_directory_page_failed:${page}:${result.status}`);
    const parsed = extractLamhaStorePage(result.payload);
    if (!parsed.rows.length && page === 1) throw new Error('lamha_directory_empty');
    rawRows.push(...parsed.rows);
    lastPage = Math.min(MAX_DIRECTORY_PAGES, Math.max(page, parsed.lastPage || page));
    page += 1;
  } while (page <= lastPage && page <= MAX_DIRECTORY_PAGES);

  const normalized = rawRows.map(row => {
    const id = String(Number(row.id ?? row.store_id ?? row.storeId ?? row.business_id ?? row.businessId) || '');
    return normalizeLamhaStoreRow(row, previousByStore.get(id));
  });
  const unique = new Map(normalized.filter(row => row.store_id).map(row => [row.store_id, row]));
  const rows = [...unique.values()];
  const invalid = rows.filter(row => !row.store_name || !row.phone);
  if (invalid.length) throw new Error(`lamha_directory_missing_required_fields:${invalid.length}`);
  if (rows.length !== rawRows.length) throw new Error(`lamha_directory_duplicate_or_invalid_ids:${rawRows.length - rows.length}`);

  const payloadHash = await sha256(rows);
  const snapshotAt = new Date().toISOString();
  const eventId = `employee-api-directory:${riyadhDateKey()}:${payloadHash.slice(0, 12)}`;
  const { data, error } = await db.rpc('ingest_platform_merchant_snapshot', {
    p_event_id: eventId,
    p_snapshot_at: snapshotAt,
    p_payload_hash: payloadHash,
    p_rows: rows,
    p_source: 'lamha_employee_api_daily',
  });
  if (error) throw new Error(`lamha_directory_ingest_failed:${error.message}`);

  await db.from('user_activity_log').insert({
    user_id: actorId,
    kind: 'sync',
    action: 'مزامنة دليل متاجر لمحة اليومية',
    detail: { automation_key: LAMHA_FINANCIAL_GUARD_KEY, run_date: riyadhDateKey(), rows: rows.length, pages: page - 1, result: data },
    path: '/customers?source=lamha-daily-sync',
  });
  return { rows: rows.length, pages: page - 1, result: data };
}

async function sourceReadiness() {
  const [latestRun, latestSuccess, platform] = await Promise.all([
    db.from('zoho_sync_runs').select('status,started_at,finished_at').order('started_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('zoho_sync_runs').select('finished_at').eq('status', 'succeeded').order('finished_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('merchants').select('uploaded_at').order('uploaded_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const sourceErrors = [latestRun.error, latestSuccess.error, platform.error].filter(Boolean);
  if (sourceErrors.length) {
    return {
      ready: false,
      zohoFresh: false,
      platformFresh: false,
      zohoLastStatus: null,
      zohoAt: null,
      platformAt: null,
      error: 'source_read_failed',
    };
  }
  const zohoAt = latestSuccess.data?.finished_at ? new Date(latestSuccess.data.finished_at) : null;
  const platformAt = platform.data?.uploaded_at ? new Date(platform.data.uploaded_at) : null;
  const zohoFresh = !!zohoAt && Date.now() - zohoAt.getTime() <= 24 * 60 * 60 * 1000;
  const platformFresh = !!platformAt && Date.now() - platformAt.getTime() <= 24 * 60 * 60 * 1000;
  return {
    ready: zohoFresh && platformFresh && latestRun.data?.status === 'succeeded',
    zohoFresh,
    platformFresh,
    zohoLastStatus: latestRun.data?.status || null,
    zohoAt: zohoAt?.toISOString() || null,
    platformAt: platformAt?.toISOString() || null,
  };
}

async function policyData() {
  const merchants = await latestMerchantRows();
  const [links, lines, customers] = await Promise.all([
    db.from('customer_merchant_links').select('customer_name,store_id').not('store_id', 'is', null),
    db.from('customer_collectible_lines').select('contact_name,line_kind,line_id,invoice_number,collectible_amount,age_days,status'),
    db.from('customer_ar').select('contact_name,balance_integrity_status'),
  ]);
  if (links.error) throw new Error(`merchant_links_failed:${links.error.message}`);
  if (lines.error) throw new Error(`collectible_lines_failed:${lines.error.message}`);
  if (customers.error) throw new Error(`customer_integrity_failed:${customers.error.message}`);
  const validCustomers = new Set((customers.data || [])
    .filter(row => row.balance_integrity_status === 'valid')
    .map(row => String(row.contact_name || '').trim()));
  return {
    rows: buildFinancialGuardRows({
    merchants: merchants.rows,
    links: (links.data || []) as Json[],
    lines: (lines.data || []) as Json[],
    validCustomers,
    }),
    snapshotAt: merchants.snapshot?.uploaded_at ? new Date(String(merchants.snapshot.uploaded_at)) : null,
  };
}

async function latestLocalStoreActions() {
  const { data, error } = await db.from('user_activity_log')
    .select('action,detail,created_at')
    .eq('kind', 'action')
    .order('created_at', { ascending: false })
    .limit(10000);
  if (error) throw new Error(`financial_guard_history_failed:${error.message}`);
  const latest = new Map<number, { action: string; automatic: boolean; createdAt: Date }>();
  for (const entry of data || []) {
    const detail = (entry.detail || {}) as Json;
    const storeId = Number(detail.store_id);
    const isLamhaAction = detail.source === 'Lamha Employee API'
      || detail.automation_key === LAMHA_FINANCIAL_GUARD_KEY;
    if (!storeId || !isLamhaAction || latest.has(storeId)) continue;
    latest.set(storeId, {
      action: String(detail.automation_action || (String(entry.action).includes('تشغيل') ? 'activate' : 'deactivate')),
      automatic: detail.automation_key === LAMHA_FINANCIAL_GUARD_KEY,
      createdAt: new Date(String(entry.created_at)),
    });
  }
  return latest;
}

async function liveRead(token: string, storeId: number) {
  const read = await lamhaFetch(token, `/stores/${storeId}`);
  return { ...read, store: liveStoreSummary(read.payload, storeId) };
}

async function applyStatus(token: string, storeId: number, action: 'activate' | 'deactivate') {
  const before = await liveRead(token, storeId);
  if (!before.ok || before.store.id !== storeId) throw new Error(`live_store_read_failed:${before.status}`);
  const desired = action === 'activate';
  if (before.store.active === desired) return { changed: false, before: before.store, after: before.store };
  if (before.store.active === null) throw new Error('live_store_status_unknown');

  const write = await lamhaFetch(token, `/stores/${storeId}/status`, {
    method: 'PATCH', body: JSON.stringify({ action }),
  });
  if (!write.ok) throw new Error(`live_store_write_failed:${write.status}`);
  const after = await liveRead(token, storeId);
  if (!after.ok || after.store.id !== storeId || after.store.active !== desired) {
    throw new Error(`live_store_verification_failed:${after.status}`);
  }
  return { changed: true, before: before.store, after: after.store };
}

async function runPolicy(token: string, actorId: string | null, execute: boolean) {
  const readiness = await sourceReadiness();
  if (!readiness.ready) return { ok: false, blocked: 'source_not_ready', readiness };

  const [policy, latestActions] = await Promise.all([policyData(), latestLocalStoreActions()]);
  const rows = policy.rows.map(row => {
    const latest = latestActions.get(row.storeId);
    if (!latest || !policy.snapshotAt || latest.createdAt <= policy.snapshotAt) return row;
    return { ...row, visualActive: latest.action === 'activate' };
  });
  const candidates = rows.map(row => {
    const latest = latestActions.get(row.storeId);
    const autoDeactivated = !!latest?.automatic && latest.action === 'deactivate';
    return { row, decision: financialGuardDecision(row, autoDeactivated) };
  })
    .filter(item => item.decision.action === 'deactivate' || item.decision.action === 'activate')
    .sort((a, b) => {
      if (a.decision.action !== b.decision.action) return a.decision.action === 'deactivate' ? -1 : 1;
      return b.row.overdue30Amount - a.row.overdue30Amount;
    });

  if (!execute) {
    return {
      ok: true,
      dryRun: true,
      readiness,
      candidates: candidates.length,
      deactivate: candidates.filter(item => item.decision.action === 'deactivate').length,
      activate: candidates.filter(item => item.decision.action === 'activate').length,
      sample: candidates.slice(0, 25).map(item => ({
        storeId: item.row.storeId,
        storeName: item.row.storeName,
        action: item.decision.action,
        overdue30Amount: item.row.overdue30Amount,
        overdue30InvoiceAmount: item.row.overdue30InvoiceAmount,
        overdue30OpeningBalanceAmount: item.row.overdue30OpeningBalanceAmount,
        overdue30InvoiceCount: item.row.overdue30InvoiceCount,
        overdue30OpeningBalanceCount: item.row.overdue30OpeningBalanceCount,
        oldestOverdueDays: item.row.oldestOverdueDays,
      })),
    };
  }

  const results = [];
  for (const item of candidates.slice(0, MAX_CHANGES_PER_POLICY_RUN)) {
    const action = item.decision.action as 'activate' | 'deactivate';
    try {
      const result = await applyStatus(token, item.row.storeId, action);
      if (result.changed) {
        await db.from('user_activity_log').insert({
          user_id: actorId,
          kind: 'action',
          action: action === 'deactivate' ? 'إيقاف مالي تلقائي لحساب متجر لمحة' : 'تشغيل مالي تلقائي لحساب متجر لمحة',
          detail: {
            automation_key: LAMHA_FINANCIAL_GUARD_KEY,
            automation_action: action,
            run_date: riyadhDateKey(),
            store_id: item.row.storeId,
            store_name: item.row.storeName,
            customer_names: item.row.customerNames,
            reason: item.decision.reason,
            overdue_30_amount: item.row.overdue30Amount,
            overdue_30_invoice_amount: item.row.overdue30InvoiceAmount,
            overdue_30_opening_balance_amount: item.row.overdue30OpeningBalanceAmount,
            overdue_30_invoice_count: item.row.overdue30InvoiceCount,
            overdue_30_opening_balance_count: item.row.overdue30OpeningBalanceCount,
            oldest_overdue_days: item.row.oldestOverdueDays,
            before_status: result.before.status,
            after_status: result.after.status,
          },
          path: `/customer-360?customer=${item.row.storeId}&source=lamha-financial-guard`,
        });
      }
      results.push({ storeId: item.row.storeId, action, ok: true, changed: result.changed });
    } catch (error) {
      results.push({ storeId: item.row.storeId, action, ok: false, error: String((error as Error).message || error) });
    }
  }

  const failed = results.filter(result => !result.ok).length;
  return {
    ok: failed === 0,
    partial: candidates.length > results.length || failed > 0,
    readiness,
    candidates: candidates.length,
    processed: results.length,
    remaining: Math.max(0, candidates.length - results.length),
    changed: results.filter(result => result.ok && result.changed).length,
    failed,
    results,
  };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return response(req, { ok: false, error: 'method_not_allowed' }, 405);
  const auth = await authorize(req);
  if (!auth) return response(req, { ok: false, error: 'forbidden' }, 403);
  const token = (Deno.env.get('LAMHA_EMPLOYEE_TOKEN') || '').trim();
  if (!token) return response(req, { ok: false, error: 'LAMHA_EMPLOYEE_TOKEN_not_configured' }, 503);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'preview');
    if (action === 'sync-directory') {
      return response(req, { ok: true, action, data: await syncDirectory(token, auth.userId) });
    }
    if (action === 'preview') {
      return response(req, { action, ...(await runPolicy(token, auth.userId, false)) });
    }
    if (action === 'policy') {
      return response(req, {
        action,
        executionEnabled: AUTOMATION_ENABLED,
        ...(await runPolicy(token, auth.userId, AUTOMATION_ENABLED)),
      });
    }
    return response(req, { ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return response(req, { ok: false, error: String((error as Error).message || error) }, 500);
  }
});
