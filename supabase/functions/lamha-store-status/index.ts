import { createClient } from 'npm:@supabase/supabase-js@2';
import { waitForLamhaApiSlot } from '../_shared/lamhaRateLimit.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const LAMHA_BASE = (Deno.env.get('LAMHA_EMPLOYEE_API_BASE') || 'https://lamha-dev.phphubx.com/api/v1').replace(/\/$/, '');
const MAX_BATCH_SIZE = 10;
const ALLOWED_ORIGINS = new Set([
  'https://shipaudit-five.vercel.app',
  'http://localhost:4173',
  'http://localhost:4177',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:4177',
  'http://127.0.0.1:5173',
]);
const ACTIONS = new Set(['get', 'activate', 'deactivate', 'batch-get', 'batch-activate', 'batch-deactivate']);

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

// Lamha exposes two different facts. is_active controls shipment creation;
// status is a visual lifecycle/activity label such as idle or stopped. Never
// derive the operational switch from the visual label.
export function storeSummary(payload: unknown) {
  const root = asRecord(payload);
  const candidate = asRecord(root.data && typeof root.data === 'object' ? root.data : root);
  const visual = asRecord(candidate.status);
  const canCreateShipments = parseOperationalActive(
    candidate.is_active ?? candidate.isActive ?? candidate.account_active ?? candidate.accountActive,
  );
  const visualStatus = String(
    visual.value ?? visual.key ?? candidate.lifecycle_status ?? (typeof candidate.status === 'string' ? candidate.status : ''),
  ).trim().toLowerCase() || null;
  const visualStatusLabel = String(
    visual.label ?? candidate.status_label ?? candidate.lifecycle_status_label ?? visualStatus ?? '',
  ).trim() || null;
  return {
    id: Number(candidate.id ?? candidate.store_id ?? candidate.business_id) || null,
    name: String(candidate.name ?? candidate.store_name ?? candidate.title ?? '') || null,
    status: visualStatus,
    visualStatus,
    visualStatusLabel,
    isActive: canCreateShipments,
    canCreateShipments,
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
  return { ok: response.ok, http: response.status, store: storeSummary(payload) };
}

type AuthContext = NonNullable<Awaited<ReturnType<typeof requireAdmin>>>;

async function processStore(
  req: Request,
  auth: AuthContext,
  employeeToken: string,
  storeId: number,
  action: 'get' | 'activate' | 'deactivate',
) {
  const before = await lamhaRequest(auth.admin, employeeToken, storeId);
  if (!before.ok || before.store.id !== storeId) {
    return { ok: false, storeId, error: 'lamha_store_read_failed', http: before.http };
  }
  if (action === 'get') {
    return { ok: true, changed: false, storeId, store: before.store };
  }

  const desiredCanCreateShipments = action === 'activate';
  if (before.store.canCreateShipments == null) {
    return {
      ok: false,
      storeId,
      error: 'operational_status_unavailable',
      visualStatus: before.store.visualStatus,
      visualStatusLabel: before.store.visualStatusLabel,
    };
  }
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { ok: false, error: 'method_not_allowed' }, 405);
  try {
    const auth = await requireAdmin(req);
    if (!auth) return json(req, { ok: false, error: 'forbidden' }, 403);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');
    if (!ACTIONS.has(action)) return json(req, { ok: false, error: 'invalid_action' }, 400);

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
      const results = [];
      for (const storeId of storeIds) {
        try {
          results.push(await processStore(req, auth, employeeToken, storeId, itemAction));
        } catch (error) {
          results.push({ ok: false, storeId, error: error instanceof Error ? error.message : String(error) });
        }
      }
      const succeeded = results.filter(result => result.ok).length;
      const changed = results.filter(result => result.ok && result.changed).length;
      return json(req, {
        ok: succeeded === results.length,
        partial: succeeded > 0 && succeeded < results.length,
        requested: results.length,
        succeeded,
        failed: results.length - succeeded,
        changed,
        results,
        source: 'Lamha Employee API (live)',
        rateLimitPerMinute: 30,
      });
    }

    const storeId = Number(body?.storeId);
    if (!Number.isSafeInteger(storeId) || storeId <= 0) {
      return json(req, { ok: false, error: 'invalid_store_id' }, 400);
    }
    const result = await processStore(req, auth, employeeToken, storeId, action as 'get' | 'activate' | 'deactivate');
    if (!result.ok) return json(req, result, result.error === 'operational_status_unavailable' ? 409 : 502);
    return json(req, { ...result, source: 'Lamha Employee API (live)', rateLimitPerMinute: 30 });
  } catch (error) {
    return json(req, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
