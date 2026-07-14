// zatca-alert — تنبيه مسائي (واتساب Hatif) بالفواتير التي لم تُرسَل لزاتكا اليوم،
// قبل انتهاء المهلة (منتصف ليل توقيت السعودية). يُستدعى من pg_cron 21:00 KSA
// (هوية X-Cron-Key ضد zoho_auth.cron_key — نمط morning-brief) أو admin يدوياً.
//
// الإعداد app_settings['zatca_alert'] (JSON): { enabled, phone, template_name }.
// enabled=false أو بلا رقم/قالب → skip (آمن افتراضياً). لا يرسل إن لم توجد فواتير اليوم.
// متغيّرات القالب: {{1}} عدد فواتير اليوم · {{2}} إجماليها ر.س · {{3}} عدد المتأخرة سابقاً.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fmt = (n: number) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

async function requireAdmin(req: Request, db: any) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  if (!data?.user) return false;
  const { data: p } = await db.from('profiles').select('role, permissions').eq('id', data.user.id).maybeSingle();
  return p?.role === 'admin' || p?.permissions?.['money.pnl'] === true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // هوية: cron (X-Cron-Key) أو admin
  let authed = false;
  const cronKey = req.headers.get('X-Cron-Key') || req.headers.get('x-cron-key');
  if (cronKey) {
    const { data: za } = await db.from('zoho_auth').select('cron_key').eq('id', 1).maybeSingle();
    if (za?.cron_key && za.cron_key === cronKey) authed = true;
  }
  if (!authed) authed = await requireAdmin(req, db);
  if (!authed) return json({ error: 'unauthorized' }, 401);

  let payload: any = {};
  try { payload = await req.json(); } catch { /* */ }
  const dryRun = payload?.action === 'preview';

  const { data: cfgRow } = await db.from('app_settings').select('value').eq('key', 'zatca_alert').maybeSingle();
  let cfg: any = null;
  try { cfg = cfgRow?.value ? JSON.parse(cfgRow.value) : null; } catch { cfg = null; }

  const { data: rpc } = await db.rpc('zatca_pending_today');
  const todayCount = rpc?.today_count || 0;
  const todayTotal = rpc?.today_total || 0;
  const overdueCount = rpc?.overdue_count || 0;
  const vars = [String(todayCount), `${fmt(todayTotal)} ر.س`, String(overdueCount)];

  if (dryRun) return json({ ok: true, preview: true, todayCount, todayTotal, overdueCount, vars, enabled: !!cfg?.enabled });
  if (!cfg?.enabled) return json({ ok: true, skipped: 'disabled', todayCount });
  if (todayCount === 0) return json({ ok: true, skipped: 'nothing_pending_today' });   // لا إزعاج
  if (!cfg.phone || !cfg.template_name) return json({ ok: false, error: 'phone/template_name غير مُعدّ' });

  // إرسال عبر Hatif (نفس مسار morning-brief)
  const cid  = (Deno.env.get('client_id') || Deno.env.get('HATIF_CLIENT_ID') || '').trim();
  const csec = (Deno.env.get('secret') || Deno.env.get('HATIF_CLIENT_SECRET') || '').trim();
  if (!cid || !csec) return json({ ok: false, error: 'أسرار Hatif غير مُعدّة' });
  try {
    const tr = await fetch('https://api.voxa.sa/connect/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cid, client_secret: csec, scope: 'VoxaAPI' }),
    });
    const tj = await tr.json();
    if (!tj.access_token) return json({ ok: false, error: 'فشل توكن Hatif' });

    // القناة: مثبّتة أو أول قناة
    let channelId = (Deno.env.get('hatif_channel_id') || Deno.env.get('HATIF_CHANNEL_ID') || cfg.channel_id || '').trim();
    if (!channelId) {
      const cr = await fetch('https://api.voxa.sa/v1/channels/service-account', { headers: { Authorization: `Bearer ${tj.access_token}` } });
      const cj = await cr.json().catch(() => ({}));
      channelId = cj?.items?.[0]?.id || '';
    }
    if (!channelId) return json({ ok: false, error: 'لا قناة Hatif متاحة' });

    const r = await fetch('https://api.voxa.sa/v1/whatsapp/service-account/sendTemplate', {
      method: 'POST', headers: { Authorization: `Bearer ${tj.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        ChannelId: channelId, TemplateName: cfg.template_name, Language: 'ar', ToNumber: cfg.phone,
        Parameters: [{ Type: 'Body', Values: vars.map((v) => ({ Type: 'text', Text: String(v) })) }],
      }),
    });
    const result = await r.json().catch(() => ({}));
    const okSend = r.ok && (result?.status === 'accepted' || !!result?.conversationEventId || !!result?.contactId);
    if (!okSend) return json({ ok: false, error: result?.message || result?.title || 'فشل الإرسال' });
    return json({ ok: true, sent: true, todayCount, vars });
  } catch (e) {
    return json({ ok: false, error: String((e as any)?.message || e) });
  }
});
