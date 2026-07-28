// zoho-events v1 — مستقبِل ويبهوكس Zoho Books (فاتورة أُنشئت / دفعة استُلمت).
// المصادقة: Authorization Bearer <anon> (بوابة المنصة) + X-Webhook-Secret
// مطابق لـenv ZOHO_WEBHOOK_SECRET (الحماية الفعلية). المستقبِل متسامح مع
// الحمولة (غير موثّقة) ويخزّن الخام دائماً. dedup_key فريد كامل.
// الأحداث للنبض فقط — لا تدخل حساب الربح أبداً.

import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');

  const secret = Deno.env.get('ZOHO_WEBHOOK_SECRET');
  if (!secret) return json({ error: 'ZOHO_WEBHOOK_SECRET غير مضبوط في الأسرار' }, 500);
  const got = req.headers.get('X-Webhook-Secret') || req.headers.get('x-webhook-secret') || '';
  if (got !== secret) return json({ error: 'forbidden' }, 403);

  let payload: Record<string, unknown> = {};
  const ct = req.headers.get('content-type') || '';
  try {
    if (ct.includes('application/json')) {
      payload = await req.json();
    } else {
      const text = await req.text();
      try { payload = JSON.parse(text); }
      catch {
        const params = new URLSearchParams(text);
        const js = params.get('JSONString') || params.get('jsonstring');
        payload = js ? JSON.parse(js) : { raw_text: text.slice(0, 4000) };
      }
    }
  } catch { payload = {}; }

  const inv = (payload.invoice || payload.Invoice) as Record<string, unknown> | undefined;
  const pay = (payload.payment || payload.customerpayment || payload.Payment) as Record<string, unknown> | undefined;
  const src = inv || pay || payload;
  const eventType = inv ? 'invoice_created' : pay ? 'payment_received' : 'unknown';
  const entityId = String(src?.invoice_id || src?.payment_id || src?.id || '') || null;
  const amount = Number(src?.total ?? src?.amount ?? 0) || null;
  const contact = String(src?.customer_name || src?.contact_name || '') || null;
  const refNo = String(src?.invoice_number || src?.payment_number || src?.number || '') || null;
  const occurred = String(src?.date || src?.last_modified_time || '') || null;

  const dedupKey = `${eventType}:${entityId || 'na'}:${amount ?? 'na'}:${occurred || Date.now()}`;

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { error } = await db.from('zoho_events').upsert({
    dedup_key: dedupKey,
    event_type: eventType,
    entity_id: entityId,
    amount,
    contact_name: contact,
    ref_number: refNo,
    occurred_at: occurred && !Number.isNaN(new Date(occurred).getTime()) ? new Date(occurred).toISOString() : new Date().toISOString(),
    payload,
    received_at: new Date().toISOString(),
  }, { onConflict: 'dedup_key' });
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, event_type: eventType });
});
