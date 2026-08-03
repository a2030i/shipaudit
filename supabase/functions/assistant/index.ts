import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OR_BASE = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_ORIGINS = [
  'https://shipaudit-five.vercel.app',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
];

const allowedOrigins = new Set([
  ...DEFAULT_ORIGINS,
  ...(Deno.env.get('ASSISTANT_ALLOWED_ORIGINS') || '').split(',').map(v => v.trim()).filter(Boolean),
]);

function cors(req: Request) {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : DEFAULT_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

const REPORT_SQL: Record<string, string> = {
  receivables_summary: `
    select
      count(*) filter (where coalesce(balance, 0) > 0.5) as open_invoice_count,
      round(coalesce(sum(balance) filter (where coalesce(balance, 0) > 0.5), 0)::numeric, 2) as outstanding_sar,
      count(*) filter (where coalesce(balance, 0) > 0.5 and due_date < current_date) as overdue_invoice_count,
      round(coalesce(sum(balance) filter (where coalesce(balance, 0) > 0.5 and due_date < current_date), 0)::numeric, 2) as overdue_sar
    from public.zoho_invoices`,
  receivables_aging: `
    select bucket, count(*) as invoice_count, round(sum(balance)::numeric, 2) as balance_sar
    from (
      select balance,
        case
          when current_date - coalesce(due_date, invoice_date) <= 30 then '0_30'
          when current_date - coalesce(due_date, invoice_date) <= 60 then '31_60'
          when current_date - coalesce(due_date, invoice_date) <= 90 then '61_90'
          else 'over_90'
        end as bucket
      from public.zoho_invoices
      where coalesce(balance, 0) > 0.5
    ) x group by bucket order by bucket`,
  carrier_summary: `
    select c.name as carrier,
      round(coalesce(sum(o.amount_dr), 0)::numeric, 2) as debit_sar,
      round(coalesce(sum(o.amount_cr), 0)::numeric, 2) as credit_sar,
      round((coalesce(sum(o.amount_dr), 0) - coalesce(sum(o.amount_cr), 0))::numeric, 2) as net_sar
    from public.carriers c
    left join public.carrier_operations o on o.carrier_id = c.id
    group by c.id, c.name order by abs(coalesce(sum(o.amount_dr), 0) - coalesce(sum(o.amount_cr), 0)) desc
    limit 20`,
  audit_summary: `
    select
      count(*) as audit_count,
      count(*) filter (where review_status = 'approved') as approved_count,
      count(*) filter (where coalesce(mismatch_count, 0) > 0) as audits_with_mismatches,
      round(coalesce(sum(total_billed), 0)::numeric, 2) as total_billed_sar
    from public.audits`,
  merchant_summary: `
    with latest as (
      select snapshot_id from public.merchants order by uploaded_at desc limit 1
    )
    select status, billing_type, count(*) as merchant_count,
      round(coalesce(sum(wallet_balance), 0)::numeric, 2) as wallet_sar
    from public.merchants
    where snapshot_id = (select snapshot_id from latest)
    group by status, billing_type order by status, billing_type`,
};

const SYSTEM_PROMPT = `أنت المساعد المالي الداخلي لمنصة ShipAudit.
تعتمد إجاباتك فقط على التقارير المجمعة المتاحة عبر run_report.
لا تطلب أسماء عملاء أو هواتف أو أرقام فواتير، ولا تخمّن بيانات غير موجودة.
اكتب بالعربية بإيجاز، واذكر الأرقام بوحدة ر.س مع توصية عملية واضحة.`;

const TOOLS = [{
  type: 'function',
  function: {
    name: 'run_report',
    description: 'يشغّل تقريراً مالياً مجمعاً ومحدداً مسبقاً بلا SQL حر أو بيانات عملاء شخصية.',
    parameters: {
      type: 'object',
      properties: {
        report: {
          type: 'string',
          enum: Object.keys(REPORT_SQL),
        },
      },
      required: ['report'],
      additionalProperties: false,
    },
  },
}];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { ok: false, error: 'Method not allowed' }, 405);

  const authorization = req.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) {
    return json(req, { ok: false, error: 'يلزم تسجيل الدخول' }, 401);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const openRouterKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!url || !anonKey || !serviceKey || !openRouterKey) {
    return json(req, { ok: false, error: 'إعدادات الخادم غير مكتملة' }, 503);
  }

  const scoped = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: authData, error: authError } = await scoped.auth.getUser();
  if (authError || !authData.user) return json(req, { ok: false, error: 'جلسة غير صالحة' }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role, permissions')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (profileError || !profile) return json(req, { ok: false, error: 'ملف المستخدم غير موجود' }, 403);
  const allowed = profile.role === 'admin' || profile.permissions?.['system.ai_assistant'] === true;
  if (!allowed) return json(req, { ok: false, error: 'لا تملك صلاحية المساعد المالي' }, 403);

  let payload: any;
  try { payload = await req.json(); } catch { return json(req, { ok: false, error: 'جسم غير صالح' }, 400); }
  const messages = (Array.isArray(payload?.messages) ? payload.messages : [])
    .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
    .slice(-12)
    .map((m: any) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  if (!messages.length) return json(req, { ok: false, error: 'لا توجد رسالة' }, 400);

  const llmMessages: any[] = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];
  const queries: Array<{ report: string; rowCount: number }> = [];
  const model = Deno.env.get('ASSISTANT_MODEL') || 'google/gemini-2.0-flash-001';

  const callLlm = async () => {
    const response = await fetch(OR_BASE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'ShipAudit Assistant',
      },
      body: JSON.stringify({ model, temperature: 0.1, max_tokens: 900, tools: TOOLS, tool_choice: 'auto', messages: llmMessages }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `LLM ${response.status}`);
    return data?.choices?.[0]?.message;
  };

  try {
    for (let step = 0; step < 4; step += 1) {
      const message = await callLlm();
      if (!message) throw new Error('لم يصل رد من النموذج');
      llmMessages.push(message);
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (!calls.length) return json(req, { ok: true, answer: message.content || '', queries });

      for (const call of calls.slice(0, 3)) {
        let output: unknown;
        try {
          const args = JSON.parse(call.function?.arguments || '{}');
          const report = String(args.report || '');
          const sql = REPORT_SQL[report];
          if (!sql) throw new Error('التقرير غير مسموح');
          const { data, error } = await admin.rpc('assistant_readonly_sql', { q: sql });
          if (error) throw error;
          const rows = Array.isArray(data) ? data.slice(0, 50) : data;
          queries.push({ report, rowCount: Array.isArray(rows) ? rows.length : 0 });
          output = rows;
        } catch (error) {
          output = { error: String((error as any)?.message || error) };
        }
        llmMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output).slice(0, 8000) });
      }
    }
    return json(req, { ok: false, error: 'تعذر إكمال التحليل ضمن الحد الآمن', queries }, 422);
  } catch (error) {
    return json(req, { ok: false, error: String((error as any)?.message || error), queries }, 502);
  }
});
