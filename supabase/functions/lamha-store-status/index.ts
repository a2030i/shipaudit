import { createClient } from 'npm:@supabase/supabase-js@2';
import { waitForLamhaApiSlot } from '../_shared/lamhaRateLimit.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const LAMHA_BASE = (Deno.env.get('LAMHA_EMPLOYEE_API_BASE') || 'https://lamha-dev.phphubx.com/api/v1').replace(/\/$/, '');
const MAX_BATCH_SIZE = 10;
const MAX_RESTORE_IDS = 5000;
const STATUS_SCAN_ACTION = 'فحص حالات حسابات لمحة';
const STATUS_CACHE_TTL_MS = 15 * 60 * 1000;
const FINANCIAL_GUARD_KEY = 'lamha_financial_guard';
const ALLOWED_ORIGINS = new Set([
  'https://shipaudit-five.vercel.app',
  'http://localhost:4173',
  'http://localhost:4177',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:4177',
  'http://127.0.0.1:5173',
]);
const ACTIONS = new Set(['get', 'activate', 'deactivate', 'batch-get', 'batch-activate', 'batch-deactivate', 'restore-scan']);

function cors(req: Request) {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://shipaudit-five.vercel.app',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const adminClient = () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function requireAdmin(req: Request) {
  const authorization = req.headers.get('authorization') || '';
  const jwt = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return null;
  const admin = adminClient();
  const { data: auth, error } = await admin.auth.getUser(jwt);
  if (error || !auth.user) return null;
  const { data: profile } = await admin.from('profiles').select('role').eq('id', auth.user.id).maybeSingle();
  return profile?.role === 'admin' ? { user: auth.user, admin } : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseOperationalActive(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'active', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'inactive', 'disabled'].includes(normalized)) return false;
  return null;
}

function normalizeStatusText(value: unknown) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[\s_-]+/g, ' ')
    : '';
}

function parseLamhaVisualActive(...values: unknown[]): boolean | null {
  for (const value of values) {
    const normalized = normalizeStatusText(value);
    if (['active', 'نشط'].includes(normalized)) return true;
    if (['inactive', 'غير نشط'].includes(normalized)) return false;
  }
  return null;
}

function nestedRecords(value: unknown, maxDepth = 5) {
  const records: Record<string, unknown>[] = [];
  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new Set<object>();
  while (queue.length) {
    const current = queue.shift()!;
    if (!current.value || typeof current.value !== 'object' || seen.has(current.value as object)) continue;
    seen.add(current.value as object);
    if (Array.isArray(current.value)) {
      if (current.depth < maxDepth) current.value.forEach(item => queue.push({ value: item, depth: current.depth + 1 }));
      continue;
    }
    const record = current.value as Record<string, unknown>;
    records.push(record);
    if (current.depth < maxDepth) {
      Object.values(record).forEach(item => {
        if (item && typeof item === 'object') queue.push({ value: item, depth: current.depth + 1 });
      });
    }
  }
  return records;
}

const recordStoreId = (record: Record<string, unknown>) =>
  Number(record.id ?? record.store_id ?? record.storeId ?? record.business_id ?? record.businessId) || null;

const hasOperationalField = (record: Record<string, unknown>) =>
  ['is_active', 'isActive', 'account_active', 'accountActive'].some(key => Object.hasOwn(record, key));

// Lamha's employee API does not expose a separate operational flag. Shipment
// creation can be read with certainty only when the direct Lamha status is
// exactly active or inactive. Idle/stopped remain informational on reads, but
// an explicit admin activate/deactivate command may still transition them to a
// verifiable active/inactive state.
export function storeSummary(payload: unknown, expectedStoreId: number | null = null) {
  const records = nestedRecords(payload);
  const identity = records.find(record => expectedStoreId != null && recordStoreId(record) === expectedStoreId)
    || records.find(record => recordStoreId(record) != null)
    || asRecord(payload);
  const operational = records.find(record => expectedStoreId != null && recordStoreId(record) === expectedStoreId && hasOperationalField(record))
    || records.find(hasOperationalField)
    || identity;
  const candidate = { ...identity, ...operational };
  const visual = asRecord(candidate.status);
  const visualStatus = String(
    visual.value ?? visual.key ?? visual.slug ?? visual.name
      ?? candidate.store_status ?? candidate.storeStatus ?? candidate.lifecycle_status
      ?? (typeof candidate.status === 'string' ? candidate.status : ''),
  ).trim().toLowerCase() || null;
  const visualStatusLabel = String(
    visual.label ?? visual.name ?? candidate.status_label ?? candidate.statusLabel
      ?? candidate.store_status_label ?? candidate.storeStatusLabel
      ?? candidate.lifecycle_status_label ?? visualStatus ?? '',
  ).trim() || null;
  const explicitOperational = parseOperationalActive(
    candidate.is_active ?? candidate.isActive ?? candidate.account_active ?? candidate.accountActive,
  );
  const visualActive = parseLamhaVisualActive(visualStatus, visualStatusLabel);
  const canCreateShipments = explicitOperational ?? visualActive;
  return {
    id: recordStoreId(identity),
    name: String(candidate.name ?? candidate.store_name ?? candidate.title ?? '') || null,
    status: visualStatus,
    visualStatus,
    visualStatusLabel,
    isActive: canCreateShipments,
    canCreateShipments,
    shipmentPermissionSource: explicitOperational != null ? 'explicit_field' : visualActive != null ? 'lamha_status' : null,
  };
}

async function lamhaRequest(
  admin: ReturnType<typeof adminClient>,
  employeeToken: string,
  storeId: number,
  action: string | null = null,
) {
  await waitForLamhaApiSlot(admin, employeeToken, `lamha-store-status:${action || 'get'}`);
  const response = await fetch(`${LAMHA_BASE}/stores/${storeId}${action ? '/status' : ''}`, {
    method: action ? 'PATCH' : 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Authorization: `Bearer ${employeeToken}`,
    },
    body: action ? JSON.stringify({ action }) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, http: response.status, store: storeSummary(payload, storeId) };
}

type AuthContext = NonNullable<Awaited<ReturnType<typeof requireAdmin>>>;

async function processStore(
  req: Request,
  auth: AuthContext,
  employeeToken: string,
  storeId: number,
  action: 'get' | 'activate' | 'deactivate',
  context = 'direct',
) {
  const before = await lamhaRequest(auth.admin, employeeToken, storeId);
  if (!before.ok || before.store.id !== storeId) {
    return { ok: false, storeId, error: 'lamha_store_read_failed', http: before.http };
  }
  if (action === 'get') {
    return { ok: true, changed: false, storeId, store: before.store };
  }

  const desiredCanCreateShipments = action === 'activate';
  if (before.store.canCreateShipments === desiredCanCreateShipments) {
    return { ok: true, changed: false, storeId, store: before.store };
  }

  const write = await lamhaRequest(auth.admin, employeeToken, storeId, action);
  if (!write.ok) return { ok: false, storeId, error: 'lamha_status_write_failed', http: write.http };
  const after = await lamhaRequest(auth.admin, employeeToken, storeId);
  if (!after.ok || after.store.id !== storeId || after.store.canCreateShipments !== desiredCanCreateShipments) {
    return {
      ok: false,
      storeId,
      error: 'lamha_status_verification_failed',
      http: after.http,
      observedStatus: after.store.visualStatus,
      canCreateShipments: after.store.canCreateShipments,
    };
  }

  await auth.admin.from('user_activity_log').insert({
    user_id: auth.user.id,
    kind: 'action',
    action: action === 'activate' ? 'تشغيل حساب متجر في لمحة' : 'إيقاف حساب متجر في لمحة',
    detail: {
      store_id: storeId,
      store_name: after.store.name || before.store.name,
      before_visual_status: before.store.visualStatus,
      after_visual_status: after.store.visualStatus,
      before_can_create_shipments: before.store.canCreateShipments,
      after_can_create_shipments: after.store.canCreateShipments,
      source: 'Lamha Employee API',
      context,
    },
    path: `/customer-360?customer=${storeId}`,
    user_agent: req.headers.get('user-agent')?.slice(0, 300) || null,
  });

  return {
    ok: true,
    changed: true,
    storeId,
    store: after.store,
    beforeCanCreateShipments: before.store.canCreateShipments,
  };
}

function cachedResult(result: Record<string, any>, checkedAt: string) {
  const store = result?.store && typeof result.store === 'object' ? result.store : {};
  return {
    ok: result?.ok === true,
    changed: result?.changed === true,
    storeId: Number(result?.storeId) || null,
    error: result?.ok === true ? null : String(result?.error || 'lamha_store_read_failed'),
    checkedAt,
    store: result?.ok === true ? {
      id: Number(store.id) || Number(result?.storeId) || null,
      name: store.name || null,
      status: store.status || null,
      visualStatus: store.visualStatus || null,
      visualStatusLabel: store.visualStatusLabel || null,
      canCreateShipments: typeof store.canCreateShipments === 'boolean' ? store.canCreateShipments : null,
      shipmentPermissionSource: store.shipmentPermissionSource || null,
    } : null,
  };
}

async function persistStatusScan(
  auth: AuthContext,
  mode: string,
  context: string,
  results: Record<string, any>[],
) {
  const checkedAt = new Date().toISOString();
  const observations = results.map(result => cachedResult(result, checkedAt));
  const { error } = await auth.admin.from('user_activity_log').insert({
    user_id: auth.user.id,
    kind: 'data',
    action: STATUS_SCAN_ACTION,
    detail: {
      source: 'Lamha Employee API',
      context,
      mode,
      checked_at: checkedAt,
      results: observations,
    },
    path: '/customer-money?source=lamha-financial-policy',
  });
  if (error) console.error('[lamha-store-status] scan cache:', error.message || error);
  return { observations, cacheSaved: !error };
}

async function restoreStatusScan(auth: AuthContext, requestedStoreIds: number[]) {
  const requested = new Set(requestedStoreIds);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [scanRows, actionRows] = await Promise.all([
    auth.admin.from('user_activity_log')
      .select('detail,created_at')
      .eq('kind', 'data')
      .eq('action', STATUS_SCAN_ACTION)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1000),
    auth.admin.from('user_activity_log')
      .select('action,detail,created_at')
      .eq('kind', 'action')
      .ilike('action', '%حساب متجر%لمحة%')
      .order('created_at', { ascending: false })
      .limit(10000),
  ]);
  if (scanRows.error) throw new Error(`scan_cache_read_failed:${scanRows.error.message}`);
  if (actionRows.error) throw new Error(`financial_hold_history_failed:${actionRows.error.message}`);

  const latestResults = new Map<number, Record<string, any>>();
  for (const row of scanRows.data || []) {
    const detail = row.detail && typeof row.detail === 'object' ? row.detail as Record<string, any> : {};
    for (const raw of Array.isArray(detail.results) ? detail.results : []) {
      const storeId = Number(raw?.storeId);
      if (!requested.has(storeId) || latestResults.has(storeId)) continue;
      latestResults.set(storeId, {
        ...raw,
        storeId,
        checkedAt: raw?.checkedAt || detail.checked_at || row.created_at,
      });
    }
  }

  const latestFinancialAction = new Map<number, { action: string; financial: boolean }>();
  for (const row of actionRows.data || []) {
    const detail = row.detail && typeof row.detail === 'object' ? row.detail as Record<string, any> : {};
    const storeId = Number(detail.store_id);
    if (!requested.has(storeId) || latestFinancialAction.has(storeId)) continue;
    const action = String(detail.automation_action || (String(row.action).includes('تشغيل') ? 'activate' : 'deactivate'));
    const financial = detail.automation_key === FINANCIAL_GUARD_KEY || detail.context === 'financial_policy';
    latestFinancialAction.set(storeId, { action, financial });
  }
  const financialHoldStoreIds = [...latestFinancialAction]
    .filter(([, value]) => value.financial && value.action === 'deactivate')
    .map(([storeId]) => storeId);

  return {
    results: [...latestResults.values()],
    financialHoldStoreIds,
    freshForSeconds: STATUS_CACHE_TTL_MS / 1000,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { ok: false, error: 'method_not_allowed' }, 405);
  try {
    const auth = await requireAdmin(req);
    if (!auth) return json(req, { ok: false, error: 'forbidden' }, 403);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');
    if (!ACTIONS.has(action)) return json(req, { ok: false, error: 'invalid_action' }, 400);

    if (action === 'restore-scan') {
      const storeIds = [...new Set((Array.isArray(body?.storeIds) ? body.storeIds : [])
        .map(Number)
        .filter((id: number) => Number.isSafeInteger(id) && id > 0))];
      if (!storeIds.length || storeIds.length > MAX_RESTORE_IDS) {
        return json(req, { ok: false, error: 'invalid_restore_scope', maxStoreIds: MAX_RESTORE_IDS }, 400);
      }
      return json(req, { ok: true, ...(await restoreStatusScan(auth, storeIds)) });
    }

    const employeeToken = (Deno.env.get('LAMHA_EMPLOYEE_TOKEN') || '').trim();
    if (!employeeToken) return json(req, { ok: false, error: 'LAMHA_EMPLOYEE_TOKEN_not_configured' }, 503);

    if (action.startsWith('batch-')) {
      const storeIds = [...new Set((Array.isArray(body?.storeIds) ? body.storeIds : [])
        .map(Number)
        .filter((id: number) => Number.isSafeInteger(id) && id > 0))];
      if (!storeIds.length || storeIds.length > MAX_BATCH_SIZE) {
        return json(req, { ok: false, error: 'invalid_batch', maxBatchSize: MAX_BATCH_SIZE }, 400);
      }
      const itemAction = action.slice(6) as 'get' | 'activate' | 'deactivate';
      const context = body?.context === 'financial_policy' ? 'financial_policy' : 'direct';
      const results = [];
      for (const storeId of storeIds) {
        try {
          results.push(await processStore(req, auth, employeeToken, storeId, itemAction, context));
        } catch (error) {
          results.push({ ok: false, storeId, error: error instanceof Error ? error.message : String(error) });
        }
      }
      const succeeded = results.filter(result => result.ok).length;
      const changed = results.filter(result => result.ok && result.changed).length;
      const cached = await persistStatusScan(auth, itemAction, context, results);
      return json(req, {
        ok: succeeded === results.length,
        partial: succeeded > 0 && succeeded < results.length,
        requested: results.length,
        succeeded,
        failed: results.length - succeeded,
        changed,
        results: cached.observations.map(result => ({ ...result, cacheSaved: cached.cacheSaved })),
        cacheSaved: cached.cacheSaved,
        source: 'Lamha Employee API (live)',
        rateLimitPerMinute: 30,
      });
    }

    const storeId = Number(body?.storeId);
    if (!Number.isSafeInteger(storeId) || storeId <= 0) {
      return json(req, { ok: false, error: 'invalid_store_id' }, 400);
    }
    const context = body?.context === 'financial_policy' ? 'financial_policy' : 'direct';
    const result = await processStore(req, auth, employeeToken, storeId, action as 'get' | 'activate' | 'deactivate', context);
    if (!result.ok) return json(req, result, 502);
    const cached = await persistStatusScan(auth, action, context, [result]);
    return json(req, { ...cached.observations[0], cacheSaved: cached.cacheSaved, source: 'Lamha Employee API (live)', rateLimitPerMinute: 30 });
  } catch (error) {
    return json(req, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
