// zoho-webhook v1 — يستقبل Webhooks زوهو ويحدّث المرآة المحلية فوراً (0 استدعاء
// زوهو). يُلغي نافذة تقادم الـ30 دقيقة: أي تغيّر في فاتورة/إشعار/دفعة يصل لحظياً.
//
// الأمان: verify_jwt=false (زوهو لا يرسل JWT). التحقّق بسرّ في الرابط
//   (?key=) أو ترويسة x-webhook-key، يُقارن بـ zoho_auth.webhook_key.
//
// إعداد في زوهو Books: Settings → Automation → Workflow Rules → قاعدة لكل
//   وحدة (Invoices/Credit Notes/Customer Payments) عند Create+Edit → إجراء
//   Webhook: URL = https://<project>.supabase.co/functions/v1/zoho-webhook?key=<السرّ>
//   Method=POST · Module=نفس الوحدة · Body=JSON (الوحدة الكاملة).
//
// المرآة كاش فقط (تُعاد مزامنتها كل 30د كشبكة أمان)، فالكتابة هنا غير حسّاسة.

import { createClient } from 'npm:@supabase/supabase-js@2';

const svc = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const s = (v: unknown) => (v == null ? null : String(v));
// void/deleted → رصيد صفر (يخرج من استعلامات «المفتوح»)
const balOf = (status: unknown, balance: unknown) =>
  /void|delet/i.test(String(status || '')) ? 0 : num(balance);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  const db = svc();
  const url = new URL(req.url);
  const key = url.searchParams.get('key') || req.headers.get('x-webhook-key') || '';

  const { data: za } = await db.from('zoho_auth').select('webhook_key').eq('id', 1).maybeSingle();
  if (!za?.webhook_key || key !== za.webhook_key) return new Response('forbidden', { status: 403 });

  // زوهو قد يرسل الجسم بترويسة Content-Type ليست application/json (نص/form)
  // فـreq.json() يرفضه (كان يرجع 400). نقرأ النص الخام ونحلّله بمرونة.
  let body: any = {};
  let raw = '';
  try {
    raw = await req.text();
    body = JSON.parse(raw);
  } catch {
    try {  // ربما form-urlencoded (قد يحمل الحمولة تحت JSONString أو أزواج مسطّحة)
      const p = new URLSearchParams(raw);
      const o: Record<string, string> = {};
      for (const [k, v] of p) o[k] = v;
      body = o.JSONString ? JSON.parse(o.JSONString) : o;
    } catch { body = {}; }
  }
  if (!body || typeof body !== 'object') body = {};

  // زوهو قد يلفّ الكيان تحت مفتاح، أو يرسله في الجذر
  const inv = body.invoice || (body.invoice_id ? body : null);
  const cn  = body.creditnote || (body.creditnote_id ? body : null);
  const pay = body.payment || body.customerpayment || (body.payment_id ? body : null);
  const now = new Date().toISOString();
  let updated = 'none';

  try {
    if (inv?.invoice_id) {
      await db.from('zoho_invoices').upsert({
        zoho_id: s(inv.invoice_id), invoice_number: s(inv.invoice_number),
        customer_name: s(inv.customer_name), date: inv.date || null,
        total: num(inv.total), balance: balOf(inv.status, inv.balance), status: s(inv.status),
        last_modified: now, synced_at: now });
      updated = 'invoice';
    } else if (cn?.creditnote_id) {
      await db.from('zoho_creditnotes').upsert({
        zoho_id: s(cn.creditnote_id), creditnote_number: s(cn.creditnote_number),
        customer_name: s(cn.customer_name), date: cn.date || null,
        total: num(cn.total), balance: balOf(cn.status, cn.balance), status: s(cn.status),
        last_modified: now, synced_at: now });
      updated = 'creditnote';
    } else if (pay?.payment_id) {
      await db.from('zoho_payments').upsert({
        zoho_id: s(pay.payment_id), customer_name: s(pay.customer_name), date: pay.date || null,
        amount: num(pay.amount), unused_amount: num(pay.unused_amount), mode: s(pay.payment_mode),
        invoice_numbers: s(pay.invoice_numbers) || '', last_modified: now, synced_at: now });
      updated = 'payment';
    }
    // لم نتعرّف على الكيان → سجّل الخام لتشخيص شكل حمولة زوهو
    if (updated === 'none') console.error('[zoho-webhook shape]', raw.slice(0, 800));
    return new Response(JSON.stringify({ ok: true, updated }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[zoho-webhook]', String((e as Error)?.message || e));
    // 200 حتى لا يعيد زوهو المحاولة بلا نهاية؛ المزامنة الدورية شبكة الأمان.
    return new Response(JSON.stringify({ ok: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
});
