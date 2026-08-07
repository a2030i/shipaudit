// morning-brief v3 — ملخّص إدارة موسّع عبر Hatif/Voxa.
// يُستدعى من pg_cron يومياً 7:15 KSA (هوية X-Cron-Key — نفس نمط zoho-sync v9)
// أو يدوياً من التطبيق (مستخدم admin أو معه money.pnl/receivables.view).
//
// يقرأ الإعداد من app_settings key='morning_brief' (JSON):
//   { enabled, phone, template_name, template_language, channel_id, report_mode }
// enabled=false أو غياب الإعداد → يرجع skip بلا إرسال.
//
// الوضع المختصر يحافظ على عقد القالب القديم (6 متغيرات). الوضع الموسّع
// يستخدم قالباً مستقلاً من 16 متغيراً، ويضيف البنوك والموردين والتحصيل
// والتشغيل والمبيعات والتكاملات من RPC قراءة فقط واحد.
// متغيّرات القالب المختصر بالترتيب:
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
const money = (n: unknown) => Number(n || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const safeDate = (value: unknown) => value
  ? new Date(String(value)).toLocaleString('ar-SA-u-ca-gregory', {
      dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Riyadh',
    })
  : 'غير متوفر';

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

  // ── الأرقام: لقطة إدارة واحدة، بلا أي كتابة مالية ──
  const { data: snapshot, error: snapshotErr } = await db.rpc('morning_brief_management_snapshot');
  if (snapshotErr) return json({ ok: false, error: `management snapshot: ${snapshotErr.message}` });

  const customer = snapshot?.customer || {};
  const finance = snapshot?.finance || {};
  const collections = snapshot?.collections || {};
  const operations = snapshot?.operations || {};
  const sales = snapshot?.sales || {};
  const system = snapshot?.system || {};
  const customers: any[] = Array.isArray(customer?.customers) ? customer.customers : [];
  const topCustomers = customers.slice(0, 5)
    .map((c: any) => `${(c.store_name || c.name || '').slice(0, 24)} ${fmt(c.owed)}`);
  const top3 = topCustomers.slice(0, 3).join(' · ') || 'لا مدينين';
  const top5 = topCustomers.join(' · ') || 'لا مدينين';

  const today = new Date().toLocaleDateString('ar-SA-u-ca-gregory', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Riyadh',
  });
  const compactVars = [
    today,
    `${fmt(customer?.outstanding)} ر.س (${customer?.outstanding_cnt || 0} عميل)`,
    `${fmt(customer?.overdue_amt)} ر.س`,
    `${fmt(customer?.collected_this_month)} ر.س`,
    top3,
    String(system?.pending_webhooks || 0),
  ];

  const aging = customer?.aging || {};
  const alertItems = [
    Number(finance?.uncategorized_bank_operations || 0) > 0 && `${finance.uncategorized_bank_operations} عملية بنكية بلا تصنيف`,
    Math.abs(Number(finance?.statement_vs_book_difference || 0)) > 0.5 && `فرق بنك ${money(finance.statement_vs_book_difference)}`,
    Number(collections?.missing_tasks || 0) > 0 && `${collections.missing_tasks} عميل بلا مهمة تحصيل`,
    Number(collections?.broken_promises || 0) > 0 && `${collections.broken_promises} وعد سداد متجاوز`,
    Number(finance?.overdue_bills || 0) > 0 && `${finance.overdue_bills} فاتورة مورد متأخرة`,
    Number(operations?.missing_carrier_schedules || 0) > 0 && `${operations.missing_carrier_schedules} ناقل جدوله ناقص`,
    Number(system?.zatca_pending || 0) > 0 && `${system.zatca_pending} فاتورة زاتكا`,
    Number(system?.integration_issues || 0) > 0 && `${system.integration_issues} تكامل يحتاج مراجعة`,
    Number(sales?.unassigned_inbound_leads || 0) > 0 && `${sales.unassigned_inbound_leads} ليد وارد بلا مسؤول`,
  ].filter(Boolean) as string[];
  const health = alertItems.length === 0
    ? 'الوضع مستقر — لا توجد إشارات حرجة'
    : `${alertItems.length} إشارات تحتاج قرار: ${alertItems.slice(0, 4).join(' · ')}`;

  const expandedVars = [
    today,
    health,
    `كشف ${money(finance?.statement_balance)} · زوهو ${money(finance?.book_balance)} · الفرق ${money(finance?.statement_vs_book_difference)} ر.س`,
    `${finance?.uncategorized_bank_operations || 0} عملية غير مصنفة · ${finance?.linked_bank_accounts || 0} حساب مربوط · آخر كشف ${finance?.statement_as_of || 'غير متوفر'}`,
    `${money(customer?.outstanding)} ر.س لدى ${customer?.outstanding_cnt || 0} عميل`,
    `${money(customer?.overdue_amt)} ر.س · افتتاحي ${money(aging?.opening_balance)} ر.س`,
    `0–30: ${money(aging?.b0_30)} · 31–60: ${money(aging?.b31_60)} · 61–90: ${money(aging?.b61_90)} · +90: ${money(aging?.b90p)}`,
    `هذا الشهر ${money(customer?.collected_this_month)} · السابق ${money(customer?.collected_prev_month)} ر.س`,
    top5,
    `${collections?.candidates || 0} مستحق متابعة · ${collections?.missing_tasks || 0} بلا مهمة (${money(collections?.missing_task_debt)} ر.س) · ${collections?.unassigned_customers || 0} بلا مسؤول`,
    `${collections?.promises_due_today || 0} اليوم · ${collections?.broken_promises || 0} متجاوزة`,
    `صافي الموردين ${money(finance?.vendor_net_payable)} · فواتير مفتوحة ${finance?.open_bills || 0} (${money(finance?.open_bills_balance)} ر.س)`,
    `${operations?.cycle_status === 'closed' ? 'مقفلة' : operations?.cycle_status === 'open' ? 'مفتوحة' : 'لم تبدأ'} · ${operations?.current_month_events || 0} أحداث · ${operations?.missing_carrier_schedules || 0} ناقل بجدول ناقص`,
    `${system?.zatca_pending || 0} معلقة · آخر فحص ${safeDate(system?.zatca_checked_at)}`,
    `${sales?.new_leads_today || 0} جديد اليوم · ${sales?.unassigned_inbound_leads || 0} وارد بلا مسؤول · ${sales?.unassigned_followups || 0} متابعة بلا مسؤول`,
    `${system?.integration_issues || 0} تحتاج مراجعة · ${system?.agent_failures_24h || 0} فشل وكيل/24س · زوهو ${safeDate(system?.zoho_last_sync)} · المنصة ${safeDate(system?.platform_last_snapshot)}`,
  ];
  const reportMode = cfg?.report_mode === 'expanded' ? 'expanded' : 'compact';
  const vars = reportMode === 'expanded' ? expandedVars : compactVars;
  const report = {
    generated_at: snapshot?.generated_at,
    health: { level: alertItems.length === 0 ? 'good' : alertItems.length <= 3 ? 'attention' : 'critical', alerts: alertItems },
    customer,
    finance,
    collections,
    operations,
    sales,
    system,
  };

  if (dryRun) return json({
    ok: true,
    preview: true,
    report,
    compactVars,
    expandedVars,
    vars,
    reportMode,
    cfg: {
      enabled: !!cfg?.enabled,
      phone: cfg?.phone || null,
      template_name: cfg?.template_name || null,
      report_mode: reportMode,
    },
  });

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
    return json({ ok: true, id: result?.conversationEventId || result?.contactId, vars, reportMode });
  } catch (e) {
    return json({ ok: false, error: String((e as any)?.message || e) });
  }
});
