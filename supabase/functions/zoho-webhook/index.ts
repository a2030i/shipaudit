// zoho-webhook v14 — يحدّث رصيد جهة الاتصال من لقطة الفاتورة نفسها.
// Zoho يرسل contact.customer_balance وunused_customer_credits داخل حدث الفاتورة؛
// وهذا يمنع بقاء الرصيد الافتتاحي كدين بعد وصول دفعة تسدده.
// v13 — صندوق وارد دائم + idempotency + منع الحدث القديم من دهس الأحدث.
// v7 — يستقبل Webhooks زوهو ويحدّث المرآة المحلية فوراً (0 استدعاء
// زوهو). يُلغي نافذة تقادم الـ30 دقيقة: أي تغيّر في فاتورة/إشعار/دفعة يصل لحظياً.
// مُتحقَّق حيّاً 2026-07-06: زوهو يرسل {invoice:{…}}/{payment:{…}} (وفيه
// unused_amount) → المرآة تتحدّث لحظياً. نبضة صحة في zoho_auth.webhook_last_at.
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
import { claimWebhook, finishWebhook, sha256 } from '../_shared/zohoReliability.ts';

const svc = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const s = (v: unknown) => (v == null ? null : String(v));
// void/deleted → رصيد صفر (يخرج من استعلامات «المفتوح»)
const balOf = (status: unknown, balance: unknown) =>
  /void|delet/i.test(String(status || '')) ? 0 : num(balance);
const iso = (v: unknown) => {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

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
  const entity = inv || cn || pay;
  const updated = inv?.invoice_id ? 'invoice'
    : cn?.creditnote_id ? 'creditnote'
    : pay?.payment_id ? 'payment' : 'none';
  const entityId = s(inv?.invoice_id ?? cn?.creditnote_id ?? pay?.payment_id);
  const providerModifiedAt = iso(entity?.last_modified_time ?? entity?.updated_time);
  const eventKey = await sha256([
    req.headers.get('x-zoho-webhook-id') || '', updated, entityId || '',
    providerModifiedAt || '', raw,
  ].join('|'));

  try {
    const claim = await claimWebhook(db, {
      eventKey,
      eventType: s(body.event_type ?? body.event_name),
      entityType: updated,
      entityId,
      providerModifiedAt,
      payload: body,
    });
    if (!claim.claimed) {
      return new Response(JSON.stringify({ ok: true, duplicate: true, status: claim.status }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (updated === 'none') {
      await finishWebhook(db, eventKey, 'ignored');
      return new Response(JSON.stringify({ ok: true, updated: 'none' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    const table = updated === 'invoice' ? 'zoho_invoices'
      : updated === 'creditnote' ? 'zoho_creditnotes' : 'zoho_payments';
    if (providerModifiedAt && entityId) {
      const { data: current, error: currentError } = await db.from(table)
        .select('last_modified').eq('zoho_id', entityId).maybeSingle();
      if (currentError) throw new Error(`read current ${updated}: ${currentError.message}`);
      const currentMs = current?.last_modified ? new Date(current.last_modified).getTime() : 0;
      if (currentMs > new Date(providerModifiedAt).getTime()) {
        await finishWebhook(db, eventKey, 'ignored');
        return new Response(JSON.stringify({ ok: true, updated: 'stale_ignored' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    if (inv?.invoice_id) {
      // حالة الفاتورة الإلكترونية (زاتكا) — الحقل المؤكَّد: einvoice_details.status
      // (القيم: pushed = أُرسلت لزاتكا · فارغ/failed = لم تُدفع بعد). المسودّات لا تُدفع أصلاً.
      const ein = s(inv.einvoice_details?.status ?? inv.einvoice_status ?? inv.zatca_status);
      const row: Record<string, unknown> = {
        zoho_id: s(inv.invoice_id), invoice_number: s(inv.invoice_number),
        customer_id: s(inv.customer_id), customer_name: s(inv.customer_name), date: inv.date || null,
        due_date: inv.due_date || null,
        invoice_type: s(inv.type),
        total: num(inv.total), balance: balOf(inv.status, inv.balance), status: s(inv.status),
        last_modified: providerModifiedAt || now, synced_at: now };
      // لا تكتب einvoice_status=null فوق قيمة مخزونة (webhook بلا einvoice_details
      // كان يمسح «pushed» → فاتورة مُرسَلة لزاتكا تظهر معلّقة). نُدرجه فقط إن وُجد.
      if (ein) row.einvoice_status = ein;
      const { error } = await db.from('zoho_invoices').upsert(row);
      if (error) throw new Error(`save invoice: ${error.message}`);
      const customerBalance = inv.contact?.customer_balance;
      if (inv.customer_id && customerBalance != null && Number.isFinite(Number(customerBalance))) {
        const { error: contactError } = await db.from('zoho_contacts').update({
          outstanding_receivable: Number(customerBalance),
          unused_credits_receivable: num(inv.contact?.unused_customer_credits),
          last_modified: providerModifiedAt || now,
          synced_at: now,
        }).eq('zoho_id', s(inv.customer_id));
        if (contactError) throw new Error(`save invoice contact balance: ${contactError.message}`);
      }
    } else if (cn?.creditnote_id) {
      const { error } = await db.from('zoho_creditnotes').upsert({
        zoho_id: s(cn.creditnote_id), creditnote_number: s(cn.creditnote_number),
        customer_id: s(cn.customer_id), customer_name: s(cn.customer_name), date: cn.date || null,
        total: num(cn.total), balance: balOf(cn.status, cn.balance), status: s(cn.status),
        last_modified: providerModifiedAt || now, synced_at: now });
      if (error) throw new Error(`save creditnote: ${error.message}`);
    } else if (pay?.payment_id) {
      const { error } = await db.from('zoho_payments').upsert({
        zoho_id: s(pay.payment_id), customer_id: s(pay.customer_id),
        customer_name: s(pay.customer_name), date: pay.date || null,
        amount: num(pay.amount), unused_amount: num(pay.unused_amount), mode: s(pay.payment_mode),
        invoice_numbers: Array.isArray(pay.invoices)
          ? pay.invoices.map((v: Record<string, unknown>) => v.invoice_number).filter(Boolean).join(', ')
          : s(pay.invoice_numbers) || '',
        // Reconcile the fresh webhook payload once from the detail endpoint.
        unused_checked_at: null,
        last_modified: providerModifiedAt || now, synced_at: now });
      if (error) throw new Error(`save payment: ${error.message}`);
    }
    // نبضة خفيفة: آخر وصول webhook ونوعه — لمؤشر الصحة
    const { error: heartbeatError } = await db.from('zoho_auth')
      .update({ webhook_last_at: now, webhook_last_kind: updated }).eq('id', 1);
    if (heartbeatError) console.warn('[zoho-webhook] heartbeat:', heartbeatError.message);
    await finishWebhook(db, eventKey, 'processed');
    return new Response(JSON.stringify({ ok: true, updated }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    const message = String((e as Error)?.message || e);
    console.error('[zoho-webhook]', message);
    try { await finishWebhook(db, eventKey, 'failed', message); } catch (finishError) {
      console.error('[zoho-webhook] failed to persist failure', finishError);
    }
    // 500 يتيح لزوهو إعادة المحاولة، وصندوق الوارد يمنع أي تكرار بعد النجاح.
    return new Response(JSON.stringify({ ok: false, error: 'processing_failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
