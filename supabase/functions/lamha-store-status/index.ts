import { createClient } from 'npm:@supabase/supabase-js@2';
import { waitForLamhaApiSlot } from '../_shared/lamhaRateLimit.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const LAMHA_BASE = (Deno.env.get('LAMHA_EMPLOYEE_API_BASE') || 'https://lamha-dev.phphubx.com/api/v1').replace(/\/$/, '');
const ALLOWED_ORIGINS = new Set([
  'https://shipaudit-five.vercel.app',
  'http://localhost:4173',
  'http://localhost:4177',
  'http://localhost:5173',
]);
const ACTIONS = new Set(['get', 'activate', 'deactivate']);

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

function storeSummary(payload: unknown) {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const candidate = (root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>;
  const rawStatus = candidate.status ?? candidate.lifecycle_status ?? candidate.is_active ?? candidate.active ?? null;
  const status = typeof rawStatus === 'boolean' ? (rawStatus ? 'active' : 'inactive') : String(rawStatus || '').toLowerCase() || null;
  return {
    id: Number(candidate.id ?? candidate.store_id ?? candidate.business_id) || null,
    name: String(candidate.name ?? candidate.store_name ?? candidate.title ?? '') || null,
    status,
  };
}

async function lamhaRequest(
  admin: ReturnType<typeof adminClient>,
  employeeToken: string,
  storeId: number,
  action: string | null = null,
) {
  await waitForLamhaApiSlot(admin, `lamha-store-status:${action || 'get'}`);
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { ok: false, error: 'method_not_allowed' }, 405);
  try {
    const auth = await requireAdmin(req);
    if (!auth) return json(req, { ok: false, error: 'forbidden' }, 403);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');
    const storeId = Number(body?.storeId);
    if (!ACTIONS.has(action)) return json(req, { ok: false, error: 'invalid_action' }, 400);
    if (!Number.isSafeInteger(storeId) || storeId <= 0) return json(req, { ok: false, error: 'invalid_store_id' }, 400);

    const employeeToken = (Deno.env.get('LAMHA_EMPLOYEE_TOKEN') || '').trim();
    if (!employeeToken) return json(req, { ok: false, error: 'LAMHA_EMPLOYEE_TOKEN_not_configured' }, 503);
    const before = await lamhaRequest(auth.admin, employeeToken, storeId);
    if (!before.ok || before.store.id !== storeId) return json(req, { ok: false, error: 'lamha_store_read_failed', http: before.http }, 502);
    if (action === 'get') return json(req, { ok: true, store: before.store, source: 'Lamha Employee API (live)' });

    const desiredStatus = action === 'activate' ? 'active' : 'inactive';
    if (before.store.status === desiredStatus) return json(req, { ok: true, changed: false, store: before.store, source: 'Lamha Employee API (live)' });
    if (!['active', 'inactive'].includes(String(before.store.status))) return json(req, { ok: false, error: 'unknown_current_status', currentStatus: before.store.status }, 409);

    const write = await lamhaRequest(auth.admin, employeeToken, storeId, action);
    if (!write.ok) return json(req, { ok: false, error: 'lamha_status_write_failed', http: write.http }, 502);
    const after = await lamhaRequest(auth.admin, employeeToken, storeId);
    if (!after.ok || after.store.id !== storeId || after.store.status !== desiredStatus) {
      return json(req, { ok: false, error: 'lamha_status_verification_failed', http: after.http, observedStatus: after.store.status }, 502);
    }

    await auth.admin.from('user_activity_log').insert({
      user_id: auth.user.id,
      kind: 'action',
      action: action === 'activate' ? 'تشغيل حساب متجر في لمحة' : 'إيقاف حساب متجر في لمحة',
      detail: { store_id: storeId, store_name: after.store.name || before.store.name, before_status: before.store.status, after_status: after.store.status, source: 'Lamha Employee API' },
      path: `/customer-360?customer=${storeId}`,
      user_agent: req.headers.get('user-agent')?.slice(0, 300) || null,
    });

    return json(req, { ok: true, changed: true, store: after.store, beforeStatus: before.store.status, source: 'Lamha Employee API (live)' });
  } catch (error) {
    return json(req, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
