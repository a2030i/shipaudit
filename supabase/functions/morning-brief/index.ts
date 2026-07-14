// morning-brief v2 — ملخّص الصباح واتساب عبر Hatif/Voxa (استُبدل Respondly).
// يُستدعى من pg_cron يومياً 7:15 KSA (هوية X-Cron-Key — نفس نمط zoho-sync v9)
// أو يدوياً من التطبيق (مستخدم admin أو معه money.pnl/receivables.view).
//
// يقرأ الإعداد من app_settings key='morning_brief' (JSON):
//   { enabled, phone, template_name, template_language, channel_id }
// enabled=false أو غياب الإعداد → يرجع skip بلا إرسال.
//
// الأرقام من مصدر الحقيقة الواحد: RPC customer_money_dashboard() +
// عدّاد «فواتير تنتظر نظرتك» (webhook_events غير المستوردة).
// متغيّرات القالب بالترتيب:
//   {{1}} التاريخ · {{2}} لك عند العملاء · {{3}} منها متأخرة
//   {{4}} حصّلنا هذا الشهر · {{5}} أكبر 3 مدينين · {{6}} فواتير تنتظر

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fmt = (n: number) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

async function requireUser(req: Request, db: any) {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  const user = data?.user;
  if (!user) return null;
  const { data: prof } = await db.from('profiles').select('role, permissions').eq('id', user.id).maybeSingle();
  if (!prof) return null;
  const perms = prof.permissions || {};
  if (prof.role !== 'admin' && !perms['money.pnl'] && !perms['receivables.view']) return null;
  return { user, role: prof.role };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // ── الهوية: cron (X-Cron-Key ضد zoho_auth.cron_key) أو مستخدم مخوَّل ──
  let authed = false;
  const cronKey = req.headers.get('X-Cron-Key') || req.headers.get('x-cron-key');
  if (cronKey) {
    const { data: za } = await db.from('zoho_auth').select('cron_key').eq('id', 1).maybeSingle();
    if (za?.cron_key && za.cron_key === cronKey) authed = true;
  }
  if (!authed) authed = !!(await requireUser(req, db));
  if (!authed) return json({ error: 'unauthorized' }, 401);

  let payload: any = {};
  try { payload = await req.json(); } catch { /* جسم فارغ مسموح */ }
  const dryRun = payload?.action === 'preview';

  // ── الإعداد ──
  const { data: cfgRow } = await db.from('app_settings').select('value').eq('key', 'morning_brief').maybeSingle();
  let cfg: any = null;
  try { cfg = cfgRow?.value ? JSON.parse(cfgRow.value) : null; } catch { cfg = null; }
  if (!cfg?.enabled && !dryRun) return json({ ok: true, skipped: 'disabled' });
  if (!cfg?.phone && !dryRun) return json({ ok: false, error: 'لا رقم مستلِم في الإعداد' });

  // ── الأرقام (مصدر الحقيقة الواحد) ──
  const { data: dash, error: dashErr } = await db.rpc('customer_money_dashboard');
  if (dashErr) return json({ ok: false, error: `dashboard: ${dashErr.message}` });
  const { count: awaiting } = await db.from('webhook_events')
    .select('id', { count: 'exact', head: true })
    .is('processed_at', null).is('audit_id', null).neq('status', 'failed');

  const customers: any[] = Array.isArray(dash?.customers) ? dash.customers : [];
  const top3 = customers.slice(0, 3)
    .map((c: any) => `${(c.store_name || c.name || '').slice(0, 22)} ${fmt(c.owed)}`)
    .join(' · ') || 'لا مدينين';

  const today = new Date().toLocaleDateString('ar-SA', { weekday: 'long', day: 'numeric', month: 'long' });
  const vars = [
    today,
    `${fmt(dash?.outstanding)} ر.س (${dash?.outstanding_cnt || 0} عميل)`,
    `${fmt(dash?.overdue_amt)} ر.س`,
    `${fmt(dash?.collected_this_month)} ر.س`,
    top3,
    String(awaiting || 0),
  ];

  if (dryRun) return json({ ok: true, preview: true, vars, cfg: { enabled: !!cfg?.enabled, phone: cfg?.phone || null, template_name: cfg?.template_name || null } });

  // ── الإرسال عبر Hatif/Voxa (قالب معتمد) ──
  const cid  = (Deno.env.get('client_id') || Deno.env.get('HATIF_CLIENT_ID') || '').trim();
  const csec = (Deno.env.get('secret') || Deno.env.get('HATIF_CLIENT_SECRET') || '').trim();
  if (!cid || !csec) return json({ ok: false, error: 'أسرار Hatif غير مُعدّة (client_id/secret)' });
  if (!cfg.template_name) return json({ ok: false, error: 'template_name غير مُعدّ في الإعداد' });
  if (!cfg.channel_id) return json({ ok: false, error: 'channel_id (ChannelId) مطلوب لـHatif' });

  try {
    const tr = await fetch('https://api.voxa.sa/connect/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cid, client_secret: csec, scope: 'VoxaAPI' }),
    });
    const tj = await tr.json();
    if (!tj.access_token) return json({ ok: false, error: 'فشل توكن Hatif' });
    const r = await fetch('https://api.voxa.sa/v1/whatsapp/service-account/sendTemplate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tj.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        ChannelId: cfg.channel_id, TemplateName: cfg.template_name, Language: cfg.template_language || 'ar',
        ToNumber: cfg.phone,
        Parameters: [{ Type: 'Body', Values: vars.map((v: unknown) => ({ Type: 'text', Text: String(v ?? '') })) }],
      }),
    });
    const result = await r.json().catch(() => ({}));
    const ok = r.ok && (result?.status === 'accepted' || !!result?.conversationEventId || !!result?.contactId);
    if (!ok) return json({ ok: false, status: r.status, error: result?.message || result?.title || 'فشل الإرسال' });
    return json({ ok: true, id: result?.conversationEventId || result?.contactId, vars });
  } catch (e) {
    return json({ ok: false, error: String((e as any)?.message || e) });
  }
});
