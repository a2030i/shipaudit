// track-activity v1 (§1.36) — يسجّل حركة موظف في user_activity_log مع IP
// والدولة من ترويسات الطلب (سيرفرياً — لا يزوَّر من المتصفح).
// الهوية: JWT المستخدم عبر getUser (نمط zoho-sync). الكتابة service role.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const ALLOWED_ORIGINS = new Set([
  'https://shipaudit-five.vercel.app',
  'http://localhost:5173',
  'http://localhost:4174',
]);
function cors(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://shipaudit-five.vercel.app',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}
const json = (body: unknown, status: number, req: Request) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(req) } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405, req);
  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return json({ ok: false, error: 'unauthorized' }, 401, req);

    const b = await req.json().catch(() => ({} as Record<string, unknown>));
    const xf = req.headers.get('x-forwarded-for') ?? '';
    const ip = xf.split(',')[0].trim() || null;
    const country = req.headers.get('cf-ipcountry')
      ?? req.headers.get('x-country')
      ?? req.headers.get('x-vercel-ip-country')
      ?? null;

    const KINDS = new Set(['login', 'page', 'denied', 'export', 'action']);
    const kind = KINDS.has(String(b.kind)) ? String(b.kind) : 'action';

    await admin.from('user_activity_log').insert({
      user_id: user.id,
      kind,
      action: String(b.action ?? '').slice(0, 120) || kind,
      detail: (b.detail && typeof b.detail === 'object') ? b.detail : null,
      path: b.path ? String(b.path).slice(0, 200) : null,
      ip,
      country,
      user_agent: b.ua ? String(b.ua).slice(0, 300) : null,
    });
    return json({ ok: true }, 200, req);
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500, req);
  }
});
