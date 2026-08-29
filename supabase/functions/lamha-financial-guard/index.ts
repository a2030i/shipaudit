import { createClient } from 'npm:@supabase/supabase-js@2';
import * as XLSX from 'npm:xlsx@0.18.5';
import { waitForLamhaApiSlot } from '../_shared/lamhaRateLimit.ts';
import {
  lamhaProfileMergeRow,
  lamhaStoreProfileRecord,
} from '../_shared/lamhaStoreProfile.ts';
import {
  buildFinancialGuardRows,
  extractLamhaStorePage,
  financialGuardDecision,
  LAMHA_FINANCIAL_GUARD_KEY,
  normalizeLamhaStoreRow,
  parseLamhaAccountActive,
} from '../_shared/lamhaFinancialGuard.ts';
import { parseLamhaStoreExportRows } from '../_shared/lamhaStoreExport.ts';
import { parseLamhaStatementExportRows } from '../_shared/lamhaStatementExport.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const LAMHA_BASE = (Deno.env.get('LAMHA_EMPLOYEE_API_BASE') || 'https://app2.lamha.sa/api/v1').replace(/\/$/, '');
// 200 keeps the complete directory plus new-store detail hydration below
// Lamha's observed 30-request window (500 is rejected with HTTP 422).
const DIRECTORY_PAGE_SIZE = 200;
const MAX_DIRECTORY_PAGES = 100;
const DATABASE_PAGE_SIZE = 1000;
const DIRECTORY_STABLE_SORT = 'sort_by=id&sort_direction=asc';
// The complete export consumes one request. Together with up to ten directory
// pages, 16 detail reads keep at least three requests free inside Lamha's
// observed 30-request window.
const PROFILE_DETAIL_BUDGET = 16;
// Detail hydration is a separate read-only lane. It can run frequently while
// profiles are incomplete, then naturally becomes quiet until a seven-day
// refresh is due. Six requests remain unused inside the observed limit.
const PROFILE_DETAIL_CATCHUP_BUDGET = 24;
const PROFILE_DETAIL_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
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

async function authorize(req: Request) {
  const suppliedCronKey = (req.headers.get('x-cron-key') || '').trim();
  if (suppliedCronKey) {
    const { data: cronAllowed, error: cronError } = await db.rpc('authorize_lamha_directory_cron', {
      p_secret: suppliedCronKey,
    });
    if (!cronError && cronAllowed === true) return { kind: 'cron' as const, userId: null };
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
  const startedAt = performance.now();
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
  const rateLimitLimit = Number(result.headers.get('x-ratelimit-limit')) || null;
  const rateLimitRemaining = Number(result.headers.get('x-ratelimit-remaining'));
  return {
    ok: result.ok,
    status: result.status,
    payload,
    rateLimit: {
      limit: rateLimitLimit,
      remaining: Number.isFinite(rateLimitRemaining) ? rateLimitRemaining : null,
    },
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
  };
}

async function lamhaExportFetch(token: string) {
  const path = '/stores/export?sort_by=shipmentsCount&sort_dir=desc&page=1&per_page=50';
  await waitForLamhaApiSlot(db, token, 'lamha-financial-guard:GET:/stores/export', 75_000);
  const startedAt = performance.now();
  const result = await fetch(`${LAMHA_BASE}${path}`, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'ar',
      'X-Requested-With': 'XMLHttpRequest',
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(45_000),
  });
  const bytes = new Uint8Array(await result.arrayBuffer());
  const rateLimitLimit = Number(result.headers.get('x-ratelimit-limit')) || null;
  const rateLimitRemaining = Number(result.headers.get('x-ratelimit-remaining'));
  return {
    ok: result.ok,
    status: result.status,
    bytes,
    contentType: result.headers.get('content-type') || '',
    contentDisposition: result.headers.get('content-disposition') || '',
    rateLimit: {
      limit: rateLimitLimit,
      remaining: Number.isFinite(rateLimitRemaining) ? rateLimitRemaining : null,
    },
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
  };
}

async function lamhaStatementExportFetch(token: string) {
  const path = '/stores/statements/export';
  await waitForLamhaApiSlot(db, token, 'lamha-financial-guard:GET:/stores/statements/export', 75_000);
  const startedAt = performance.now();
  const result = await fetch(`${LAMHA_BASE}${path}`, {
    headers: {
      Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream',
      'Accept-Language': 'ar',
      'X-Requested-With': 'XMLHttpRequest',
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(45_000),
  });
  const bytes = new Uint8Array(await result.arrayBuffer());
  const rateLimitLimit = Number(result.headers.get('x-ratelimit-limit')) || null;
  const rateLimitRemaining = Number(result.headers.get('x-ratelimit-remaining'));
  return {
    ok: result.ok,
    status: result.status,
    bytes,
    contentType: result.headers.get('content-type') || '',
    contentDisposition: result.headers.get('content-disposition') || '',
    rateLimit: {
      limit: rateLimitLimit,
      remaining: Number.isFinite(rateLimitRemaining) ? rateLimitRemaining : null,
    },
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
  };
}

function parseLamhaExport(bytes: Uint8Array) {
  let workbook;
  try {
    workbook = XLSX.read(bytes, { type: 'array', cellDates: true });
  } catch (error) {
    throw new Error(`lamha_export_workbook_invalid:${String((error as Error).message || error)}`);
  }
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error('lamha_export_workbook_empty');
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][];
  return { sheetName: firstSheet, ...parseLamhaStoreExportRows(rows) };
}

function inspectLamhaStatementExport(bytes: Uint8Array) {
  let workbook;
  try {
    workbook = XLSX.read(bytes, { type: 'array', cellDates: true });
  } catch (error) {
    throw new Error(`lamha_statement_export_workbook_invalid:${String((error as Error).message || error)}`);
  }
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error('lamha_statement_export_workbook_empty');
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][];
  const parsed = parseLamhaStatementExportRows(rows);
  return {
    sheetName: firstSheet,
    headers: parsed.headers,
    storeCount: parsed.rows.length,
    balancesPresent: parsed.rows.filter(row => row.balance != null).length,
  };
}

async function probeStatementExport(token: string) {
  const exported = await lamhaStatementExportFetch(token);
  if (!exported.ok) {
    return {
      ok: false,
      readOnly: true,
      endpoint: '/stores/statements/export',
      httpStatus: exported.status,
      errorClass: exported.status === 401
        ? 'token_authentication'
        : exported.status === 403
          ? 'authorization_scope'
          : `http_${exported.status}`,
      latencyMs: exported.latencyMs,
      rateLimit: exported.rateLimit,
    };
  }
  const inspected = inspectLamhaStatementExport(exported.bytes);
  return {
    ok: true,
    readOnly: true,
    endpoint: '/stores/statements/export',
    httpStatus: exported.status,
    responseContract: 'xlsx',
    contentType: exported.contentType,
    contentDispositionPresent: Boolean(exported.contentDisposition),
    byteLength: exported.bytes.byteLength,
    latencyMs: exported.latencyMs,
    rateLimit: exported.rateLimit,
    ...inspected,
  };
}

async function syncStatementExport(token: string, actorId: string | null) {
  const exported = await lamhaStatementExportFetch(token);
  if (!exported.ok) {
    throw new Error(exported.status === 401
      ? 'lamha_statement_token_authentication_failed'
      : exported.status === 403
        ? 'lamha_statement_authorization_scope_failed'
        : `lamha_statement_export_failed:${exported.status}`);
  }
  if (!exported.contentType.includes('spreadsheetml')) {
    throw new Error(`lamha_statement_content_type_invalid:${exported.contentType || 'missing'}`);
  }

  let workbook;
  try {
    workbook = XLSX.read(exported.bytes, { type: 'array', cellDates: true });
  } catch (error) {
    throw new Error(`lamha_statement_export_workbook_invalid:${String((error as Error).message || error)}`);
  }
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error('lamha_statement_export_workbook_empty');
  const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][];
  const parsed = parseLamhaStatementExportRows(sheetRows);
  const financialRows = parsed.rows.filter(row => row.balance != null);
  if (!financialRows.length) throw new Error('lamha_statement_export_no_financial_rows');

  const sourceHash = await sha256({ headers: parsed.headers, rows: parsed.rows });
  const fileName = `lamha-statement-api-${riyadhDateKey()}-${sourceHash.slice(0, 12)}.xlsx`;
  const totalBalanceCents = financialRows.reduce(
    (sum, row) => sum + Math.round(Number(row.balance) * 100),
    0,
  );
  const { data, error } = await db.rpc('ingest_lamha_statement_snapshot', {
    p_file_name: fileName,
    p_source_hash: sourceHash,
    p_rows: financialRows,
    p_metadata: {
      endpoint: '/stores/statements/export',
      read_only: true,
      response_contract: 'xlsx',
      sheet_name: firstSheet,
      headers: parsed.headers,
      store_count: parsed.rows.length,
      financial_row_count: financialRows.length,
      total_balance: totalBalanceCents / 100,
      byte_length: exported.bytes.byteLength,
      latency_ms: exported.latencyMs,
      rate_limit: exported.rateLimit,
    },
    p_actor_id: actorId,
  });
  if (error) throw new Error(`lamha_statement_snapshot_failed:${error.message}`);
  return {
    ...data,
    fileName,
    storeCount: parsed.rows.length,
    financialRowCount: financialRows.length,
    totalBalance: totalBalanceCents / 100,
    latencyMs: exported.latencyMs,
    rateLimit: exported.rateLimit,
  };
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
  const rows: Json[] = [];
  for (let from = 0; ; from += DATABASE_PAGE_SIZE) {
    const { data, error } = await db.from('merchants').select('*')
      .eq('snapshot_id', marker.snapshot_id)
      .range(from, from + DATABASE_PAGE_SIZE - 1);
    if (error) throw new Error(`merchant_snapshot_read_failed:${error.message}`);
    rows.push(...((data || []) as Json[]));
    if ((data || []).length < DATABASE_PAGE_SIZE) break;
  }
  return { rows, snapshot: marker };
}

async function syncDirectory(token: string, actorId: string | null) {
  const previous = await latestMerchantRows();
  const previousByStore = new Map(previous.rows.map(row => [String(row.store_id), row]));
  const rawRows: Json[] = [];
  let page = 1;
  let lastPage = 1;
  let reportedTotal: number | null = null;
  let reportedPerPage: number | null = null;
  let rateLimitLimit: number | null = null;
  let lowestRateLimitRemaining: number | null = null;

  do {
    const result = await lamhaFetch(
      token,
      `/stores?page=${page}&per_page=${DIRECTORY_PAGE_SIZE}&${DIRECTORY_STABLE_SORT}`,
    );
    if (!result.ok) throw new Error(`lamha_directory_page_failed:${page}:${result.status}`);
    rateLimitLimit = result.rateLimit.limit ?? rateLimitLimit;
    if (result.rateLimit.remaining != null) {
      lowestRateLimitRemaining = lowestRateLimitRemaining == null
        ? result.rateLimit.remaining
        : Math.min(lowestRateLimitRemaining, result.rateLimit.remaining);
    }
    const parsed = extractLamhaStorePage(result.payload);
    if (!parsed.rows.length && page === 1) throw new Error('lamha_directory_empty');
    if (page === 1) {
      reportedTotal = parsed.total;
      reportedPerPage = parsed.perPage;
    }
    rawRows.push(...parsed.rows);
    lastPage = Math.min(MAX_DIRECTORY_PAGES, Math.max(page, parsed.lastPage || page));
    page += 1;
  } while (
    page <= MAX_DIRECTORY_PAGES
    && (page <= lastPage || (reportedTotal != null && rawRows.length < reportedTotal))
  );

  if (reportedTotal != null && rawRows.length !== reportedTotal) {
    throw new Error(`lamha_directory_incomplete:reported=${reportedTotal}:received=${rawRows.length}:pages=${page - 1}`);
  }

  const listCheckedAt = new Date().toISOString();
  const exportResult = await lamhaExportFetch(token);
  rateLimitLimit = exportResult.rateLimit.limit ?? rateLimitLimit;
  if (exportResult.rateLimit.remaining != null) {
    lowestRateLimitRemaining = lowestRateLimitRemaining == null
      ? exportResult.rateLimit.remaining
      : Math.min(lowestRateLimitRemaining, exportResult.rateLimit.remaining);
  }
  if (!exportResult.ok) {
    throw new Error(`lamha_export_failed:${exportResult.status}`);
  }
  if (!exportResult.contentType.includes('spreadsheetml')) {
    throw new Error(`lamha_export_content_type_invalid:${exportResult.contentType || 'missing'}`);
  }
  const parsedExport = parseLamhaExport(exportResult.bytes);
  const exportByStore = new Map(parsedExport.rows.map(row => [String(row.id), row as Json]));
  const rawByStore = new Map(rawRows.map(row => [
    String(Number(row.id ?? row.store_id ?? row.storeId ?? row.business_id ?? row.businessId) || ''),
    row,
  ]).filter(([id]) => id));
  const missingFromExport = [...rawByStore.keys()].filter(id => !exportByStore.has(id));
  const missingFromDirectory = [...exportByStore.keys()].filter(id => !rawByStore.has(id));
  if (
    parsedExport.rows.length !== rawRows.length
    || missingFromExport.length
    || missingFromDirectory.length
  ) {
    throw new Error([
      'lamha_export_directory_mismatch',
      `directory=${rawRows.length}`,
      `export=${parsedExport.rows.length}`,
      `missing_export=${missingFromExport.length}`,
      `missing_directory=${missingFromDirectory.length}`,
    ].join(':'));
  }

  const profileState: Json[] = [];
  for (let from = 0; ; from += DATABASE_PAGE_SIZE) {
    const { data, error } = await db.from('lamha_store_profiles')
      .select('store_id,api_detail_checked_at')
      .order('store_id', { ascending: true })
      .range(from, from + DATABASE_PAGE_SIZE - 1);
    if (error) throw new Error(`lamha_profile_registry_read_failed:${error.message}`);
    profileState.push(...((data || []) as Json[]));
    if ((data || []).length < DATABASE_PAGE_SIZE) break;
  }
  const detailCheckedByStore = new Map(profileState.map(row => [
    String(row.store_id),
    Date.parse(String(row.api_detail_checked_at || '')) || 0,
  ]));
  const operationalPrevious = (id: string) => {
    const previous = previousByStore.get(id) || {};
    // Shared API fields may use the preceding API snapshot as a continuity
    // fallback. Export-owned fields must come from this complete export run;
    // never carry a stale manual Excel value into a new API snapshot.
    return {
      ...previous,
      profile_status: null,
      vat_registered: null,
      zatca_completed: null,
      last_topup_at: null,
      wallet_balance: null,
    };
  };
  const needsRequiredDetail = (id: string, row: Json) => {
    const normalized = normalizeLamhaStoreRow(
      { ...row, ...(exportByStore.get(id) || {}) },
      operationalPrevious(id),
    );
    return !normalized.store_name || !normalized.phone;
  };
  const detailCandidates = [...rawByStore.entries()]
    .sort(([aId, a], [bId, b]) => {
      const requiredDelta = Number(needsRequiredDetail(bId, b)) - Number(needsRequiredDetail(aId, a));
      if (requiredDelta) return requiredDelta;
      const checkedDelta = (detailCheckedByStore.get(aId) || 0) - (detailCheckedByStore.get(bId) || 0);
      return checkedDelta || Number(aId) - Number(bId);
    })
    .slice(0, PROFILE_DETAIL_BUDGET);

  const detailByStore = new Map<string, Json>();
  const detailMeta = new Map<string, { checkedAt: string; http: number; latencyMs: number }>();
  for (const [id] of detailCandidates) {
    const detail = await lamhaFetch(token, `/stores/${id}`);
    rateLimitLimit = detail.rateLimit.limit ?? rateLimitLimit;
    if (detail.rateLimit.remaining != null) {
      lowestRateLimitRemaining = lowestRateLimitRemaining == null
        ? detail.rateLimit.remaining
        : Math.min(lowestRateLimitRemaining, detail.rateLimit.remaining);
    }
    if (!detail.ok) {
      if (detail.status === 401 || detail.status === 403) {
        throw new Error(`lamha_directory_detail_auth_failed:${id}:${detail.status}`);
      }
      continue;
    }
    const detailRecord = lamhaStoreProfileRecord(detail.payload, Number(id));
    if (!detailRecord) continue;
    detailByStore.set(id, detailRecord);
    detailMeta.set(id, {
      checkedAt: new Date().toISOString(),
      http: detail.status,
      latencyMs: detail.latencyMs,
    });
  }

  const normalized = [];
  for (const row of rawRows) {
    const id = String(Number(row.id ?? row.store_id ?? row.storeId ?? row.business_id ?? row.businessId) || '');
    const previousRow = operationalPrevious(id);
    const normalizedRow = normalizeLamhaStoreRow({
      ...row,
      ...(exportByStore.get(id) || {}),
      ...(detailByStore.get(id) || {}),
    }, previousRow);
    normalized.push(normalizedRow);
  }
  const unique = new Map(normalized.filter(row => row.store_id).map(row => [row.store_id, row]));
  const rows = [...unique.values()];
  const invalidIds = normalized.filter(row => !row.store_id).length;
  const duplicateIds = normalized.length - invalidIds - rows.length;
  const missingNames = rows.filter(row => !row.store_name).length;
  const missingPhones = rows.filter(row => !row.phone).length;
  const previousMatches = rows.filter(row => previousByStore.has(row.store_id)).length;
  if (missingNames || missingPhones) {
    throw new Error([
      'lamha_directory_missing_required_fields',
      `names=${missingNames}`,
      `phones=${missingPhones}`,
      `previous_matches=${previousMatches}`,
      `previous_rows=${previous.rows.length}`,
      `directory_rows=${rows.length}`,
      `reported_total=${reportedTotal ?? 'unknown'}`,
      `reported_per_page=${reportedPerPage ?? 'unknown'}`,
      `reported_pages=${lastPage}`,
    ].join(':'));
  }

  const profileRows = [...rawByStore.entries()].map(([id, listRecord]) => {
    const detailRecord = detailByStore.get(id);
    const meta = detailMeta.get(id);
    return lamhaProfileMergeRow({
      storeId: id,
      record: { ...listRecord, ...(exportByStore.get(id) || {}), ...(detailRecord || {}) },
      listCheckedAt,
      detailCheckedAt: meta?.checkedAt || null,
      httpStatus: meta?.http || 200,
      latencyMs: meta?.latencyMs || null,
    });
  });
  const { data: profileMerge, error: profileMergeError } = await db.rpc('merge_lamha_store_profiles_from_api', {
    p_rows: profileRows,
  });
  if (profileMergeError) throw new Error(`lamha_profile_registry_write_failed:${profileMergeError.message}`);
  if (rows.length !== rawRows.length) {
    throw new Error(`lamha_directory_duplicate_or_invalid_ids:duplicates=${duplicateIds}:invalid=${invalidIds}`);
  }

  const payloadHash = await sha256(rows);
  const snapshotAt = new Date().toISOString();
  const eventId = `employee-api-export-directory:${riyadhDateKey()}:${payloadHash.slice(0, 12)}`;
  const { data, error } = await db.rpc('ingest_platform_merchant_snapshot', {
    p_event_id: eventId,
    p_snapshot_at: snapshotAt,
    p_payload_hash: payloadHash,
    p_rows: rows,
    p_source: 'lamha_employee_api_export_daily',
  });
  if (error) throw new Error(`lamha_directory_ingest_failed:${error.message}`);

  await db.from('user_activity_log').insert({
    user_id: actorId,
    kind: 'sync',
    action: 'مزامنة دليل متاجر لمحة اليومية',
    detail: {
      automation_key: LAMHA_FINANCIAL_GUARD_KEY,
      run_date: riyadhDateKey(),
      rows: rows.length,
      pages: page - 1,
      reported_total: reportedTotal,
      reported_per_page: reportedPerPage,
      export_rows: parsedExport.rows.length,
      export_sheet: parsedExport.sheetName,
      export_bytes: exportResult.bytes.byteLength,
      export_latency_ms: exportResult.latencyMs,
      export_content_disposition: exportResult.contentDisposition,
      rate_limit: rateLimitLimit,
      lowest_rate_limit_remaining: lowestRateLimitRemaining,
      profile_list_rows: profileRows.length,
      profile_detail_rows: detailByStore.size,
      profile_merge: profileMerge,
      result: data,
    },
    path: '/customers?source=lamha-daily-sync',
  });
  return {
    rows: rows.length,
    pages: page - 1,
    reportedTotal,
    reportedPerPage,
    exportRows: parsedExport.rows.length,
    exportBytes: exportResult.bytes.byteLength,
    exportLatencyMs: exportResult.latencyMs,
    rateLimit: rateLimitLimit,
    lowestRateLimitRemaining,
    profileListRows: profileRows.length,
    profileDetailRows: detailByStore.size,
    result: data,
  };
}

async function syncProfileDetails(token: string, actorId: string | null) {
  const staleBefore = new Date(Date.now() - PROFILE_DETAIL_REFRESH_MS).toISOString();
  const { data: candidates, error: candidateError } = await db.from('lamha_store_profiles')
    .select('store_id,api_detail_checked_at')
    .or(`api_detail_checked_at.is.null,api_detail_checked_at.lt.${staleBefore}`)
    .order('api_detail_checked_at', { ascending: true, nullsFirst: true })
    .order('store_id', { ascending: true })
    .limit(PROFILE_DETAIL_CATCHUP_BUDGET);
  if (candidateError) throw new Error(`lamha_profile_candidates_failed:${candidateError.message}`);
  if (!candidates?.length) {
    return { selected: 0, hydrated: 0, notFound: 0, failed: 0, remaining: 0 };
  }

  const rows = [];
  let hydrated = 0;
  let notFound = 0;
  let failed = 0;
  let rateLimitLimit: number | null = null;
  let lowestRateLimitRemaining: number | null = null;
  for (const candidate of candidates) {
    const id = String(candidate.store_id || '').trim();
    if (!id) continue;
    const detail = await lamhaFetch(token, `/stores/${id}`);
    rateLimitLimit = detail.rateLimit.limit ?? rateLimitLimit;
    if (detail.rateLimit.remaining != null) {
      lowestRateLimitRemaining = lowestRateLimitRemaining == null
        ? detail.rateLimit.remaining
        : Math.min(lowestRateLimitRemaining, detail.rateLimit.remaining);
    }
    if (detail.status === 401 || detail.status === 403) {
      throw new Error(`lamha_profile_detail_auth_failed:${id}:${detail.status}`);
    }
    const checkedAt = new Date().toISOString();
    const record = detail.ok ? lamhaStoreProfileRecord(detail.payload, Number(id)) : null;
    if (detail.ok && record) hydrated += 1;
    else if (detail.status === 404) notFound += 1;
    else failed += 1;
    rows.push(lamhaProfileMergeRow({
      storeId: id,
      record,
      detailCheckedAt: checkedAt,
      httpStatus: detail.status,
      latencyMs: detail.latencyMs,
    }));
  }
  const { data: merge, error: mergeError } = await db.rpc('merge_lamha_store_profiles_from_api', { p_rows: rows });
  if (mergeError) throw new Error(`lamha_profile_detail_merge_failed:${mergeError.message}`);
  const { count: remaining, error: remainingError } = await db.from('lamha_store_profiles')
    .select('store_id', { count: 'exact', head: true })
    .is('api_detail_checked_at', null);
  if (remainingError) throw new Error(`lamha_profile_remaining_failed:${remainingError.message}`);

  await db.from('user_activity_log').insert({
    user_id: actorId,
    kind: 'sync',
    action: 'إثراء تفاصيل متاجر لمحة من API',
    detail: {
      automation_key: LAMHA_FINANCIAL_GUARD_KEY,
      read_only: true,
      selected: candidates.length,
      hydrated,
      not_found: notFound,
      failed,
      remaining_without_detail: remaining || 0,
      rate_limit: rateLimitLimit,
      lowest_rate_limit_remaining: lowestRateLimitRemaining,
      merge,
    },
    path: '/customers?source=lamha-profile-sync',
  });
  return {
    selected: candidates.length,
    hydrated,
    notFound,
    failed,
    remaining: remaining || 0,
    rateLimit: rateLimitLimit,
    lowestRateLimitRemaining,
  };
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
    if (auth.kind === 'cron' && !['sync-directory', 'sync-profile-details', 'probe-statement-export'].includes(action)) {
      return response(req, { ok: false, error: 'cron_read_only' }, 403);
    }
    if (action === 'sync-directory') {
      const directory = await syncDirectory(token, auth.userId);
      const statement = await syncStatementExport(token, auth.userId);
      return response(req, { ok: true, action, data: { directory, statement } });
    }
    if (action === 'sync-profile-details') {
      return response(req, { ok: true, action, data: await syncProfileDetails(token, auth.userId) });
    }
    if (action === 'probe-statement-export') {
      const data = await probeStatementExport(token);
      return response(req, { action, data }, data.ok ? 200 : data.httpStatus);
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
