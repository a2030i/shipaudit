// assistant — مساعد ShipAudit الذكي (agentic).
// LLM key stays server-side. The model answers by writing READ-ONLY SQL via
// the run_sql tool (assistant_readonly_sql RPC enforces SELECT-only + a
// read-only transaction). It loops tool→result→tool until it can answer.
//
// Body: { messages: [{role,content}], model? }
// Returns: { ok, answer, queries: [{sql, rows}] }  |  { ok:false, error }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OR_BASE = 'https://openrouter.ai/api/v1/chat/completions';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const SCHEMA = `الجداول المتاحة (Postgres):
• merchants(store_id, store_name, phone, status['نشط'|'غير نشط'], billing_type['دفع مسبق'|'دفع لاحق'], integration_type, shipment_count, last_shipment_at, created_at_platform, last_topup_at, wallet_balance, snapshot_id, uploaded_at) — snapshots، الأحدث يسود. دائماً افلتر snapshot_id=(SELECT snapshot_id FROM merchants ORDER BY uploaded_at DESC LIMIT 1)
• customer_receivables(customer_name, invoice_date, balance_amount, is_summary, snapshot_id, uploaded_at) — ذمم زوهو (snapshots). مهم: عند جمع balance_amount استبعد دائماً is_summary (WHERE NOT coalesce(is_summary,false)) — صف الملخّص يضاعف الإجمالي. الأحدث: snapshot_id=(SELECT snapshot_id FROM customer_receivables ORDER BY uploaded_at DESC LIMIT 1). لا تحمل store_id — الربط عبر customer_merchant_links
• customer_merchant_links(customer_name, store_id, match_method, confidence) — ربط عميل زوهو ↔ متجر
• customer_segments(name, filters jsonb, color) — شرائح محفوظة
• carriers(id, name, contracts jsonb, file_signature jsonb) — شركات الشحن
• carrier_operations(carrier_id, doc_type['INV'|'RV'|'COD'|'DG'...], doc_no, doc_date, amount_dr, amount_cr, status, audit_id) — الدفتر. الرصيد=SUM(amount_dr)-SUM(amount_cr)
• audits(id, carrier_name, period, row_count, mismatch_count, review_status, weight_billing_status, total_billed, total_tax, approved_at)
• audit_shipments(audit_id, awb, weight_kg, is_cod, dest_country, status, invoiced_total, expected_total, diff_total)
• cod_settlement(carrier_id, awb, amount, direction['in'|'out'], upload_id, reference_no)
• whatsapp_campaigns(name, template_name, total, sent, failed, amount_total, created_at) + whatsapp_messages(campaign_id, phone, amount, success)
RPCs جاهزة (استدعِها بـ SELECT * FROM fn(...)):
• integrity_check() — فحوص التناقضات
• carrier_cod_net_balances() — صافي COD لكل ناقل
• resolve_snapshot_names(ARRAY['اسم']) — مطابقة اسم عميل → store_id`;

const sysPrompt = (today: string) => `أنت «المحاسب الذكي» — محلّل مالي ومستشار قرارات داخل شركة لمحة (وسيط شحن: تدقيق فواتير شركات الشحن، تحصيل COD، مديونيات تجار المنصّة).
اليوم: ${today}.

مبدأ حاكم: **لا تجاوب أبداً من معرفة عامة أو نصائح إدارية عامة.** كل جواب يجب أن يستند لأرقام فعلية استعلمتها بـrun_sql من قاعدة بيانات الشركة.

عندما يسأل المدير حتى سؤال رأي/قرار (مثل «وش رايك بالديون؟»):
1. استعلِم أولاً البيانات ذات الصلة (قد تحتاج عدّة استعلامات: الإجمالي، التوزيع، أكبر العملاء، الأعمار).
2. اعرض الأرقام المفتاحية بإيجاز (أرقام فعلية، لا تعابير عامة).
3. أعطِ **توصية محددة وقابلة للتنفيذ داخل النظام**: من بالضبط (أسماء/أعداد)، بأي مبلغ، بأي أداة (حملة واتساب لشريحة، تحويل دفع لاحق→مسبق، إيقاف عميل، فحص سلامة البيانات).

أدوات القرار المتاحة في النظام (اربط توصيتك بها): صفحة الشرائح (تصنيف وتصدير)، حملات واتساب تحصيل، سجل المطالبات، فحص سلامة البيانات، الدفتر.

أسلوب الرد:
- احترافي، موجز، بلغة أعمال — لا حشو ولا جمل إنشائية (مثل «الديون تمثل تحدياً» — ممنوعة).
- الأرقام بـ«ر.س». نبّه بـ⚠️ للخلل/الخطر وـ💰 للفرص المالية.
- لو البيانات غير كافية، قل بوضوح ما الناقص وأين يُرفع في النظام.
- لا تعتذر بأنك «لا تتخذ قرارات» — دورك أن توصي بقرار مدعوم بالأرقام بوضوح وثقة.

مثال على جواب جيد لـ«وش رايك بالديون؟» (بعد استعلام):
«إجمالي المديونيات 294,070 ر.س على 84 عميل. ⚠️ أخطر بند: 38 عميل دفع مسبق عليهم 86,256 ر.س (خلل — الدفع المسبق لا يفترض عليه دين). أكبر 3 مدينين: س... (X ر.س). توصيتي: (1) شغّل فحص سلامة البيانات للـڀڃ الدفع المسبق أولاً — غالباً خطأ ربط. (2) أرسل حملة واتساب لشريحة +90 يوم.»

${SCHEMA}`;

const TOOLS = [{
  type: 'function',
  function: {
    name: 'run_sql',
    description: 'ينفّذ استعلام SELECT للقراءة فقط ويرجّع الصفوف JSON (حد 500 صف). لا يسمح بأي كتابة.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'جملة SELECT واحدة' } }, required: ['query'] },
  },
}];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const key = Deno.env.get('OPENROUTER_API_KEY');
  if (!key) return json({ ok: false, error: 'أضِف OPENROUTER_API_KEY في أسرار الدالة' }, 400);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ ok: false, error: 'جسم غير صالح' }, 400); }
  const userMessages = Array.isArray(payload?.messages) ? payload.messages : [];
  const model = payload?.model || Deno.env.get('ASSISTANT_MODEL') || 'google/gemini-2.0-flash-001';
  if (!userMessages.length) return json({ ok: false, error: 'لا توجد رسائل' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const today = new Date().toISOString().slice(0, 10);
  const messages: any[] = [{ role: 'system', content: sysPrompt(today) }, ...userMessages];
  const queries: any[] = [];

  const callLLM = async () => {
    const r = await fetch(OR_BASE, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'ShipAudit Assistant' },
      body: JSON.stringify({ model, temperature: 0.2, max_tokens: 1400, tools: TOOLS, tool_choice: 'auto', messages }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message || `LLM ${r.status}`);
    return data?.choices?.[0]?.message;
  };

  try {
    for (let step = 0; step < 7; step++) {
      const msg = await callLLM();
      messages.push(msg);
      const calls = msg?.tool_calls || [];
      if (!calls.length) {
        return json({ ok: true, answer: msg?.content || '', queries });
      }
      for (const call of calls) {
        let out: any;
        try {
          const args = JSON.parse(call.function?.arguments || '{}');
          const sql = String(args.query || '');
          const { data, error } = await admin.rpc('assistant_readonly_sql', { q: sql });
          if (error) out = { error: error.message };
          else { out = data; queries.push({ sql, rowCount: Array.isArray(data) ? data.length : 0 }); }
        } catch (e) { out = { error: String(e?.message || e) }; }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(out).slice(0, 12000) });
      }
    }
    messages.push({ role: 'user', content: 'لخّص الإجابة الآن بأرقام وتوصية محددة بلا استعلامات إضافية.' });
    const final = await callLLM();
    return json({ ok: true, answer: final?.content || 'لم أتمكّن من إكمال التحليل.', queries });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e), queries }, 200);
  }
});
