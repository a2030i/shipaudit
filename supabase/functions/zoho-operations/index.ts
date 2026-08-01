// Controlled Zoho Books writes: invoice lifecycle and bank statement import.
// Every action is admin/zoho.configure only, idempotent, audited, and scoped to
// existing documents/accounts. It never creates an invoice or deletes data.
import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_ORIGIN = 'https://shipaudit-five.vercel.app';
const CORS = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, 'Content-Type': 'application/json' },
});
const svc = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

async function requireWriter(req: Request, db: ReturnType<typeof svc>) {
  const auth = req.headers.get('Authorization') || '';
  const uc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await uc.auth.getUser();
  if (!user) return null;
  const { data: p } = await db.from('profiles').select('role,permissions').eq('id', user.id).maybeSingle();
  if (p?.role !== 'admin' && p?.permissions?.['zoho.configure'] !== true) return null;
  return user;
}

async function accessToken(db: ReturnType<typeof svc>) {
  const { data } = await db.from('zoho_auth').select('*').eq('id', 1).maybeSingle();
  if (!data?.refresh_token) throw new Error('zoho_not_connected');
  const r = await fetch(`https://${data.accounts_domain}/oauth/v2/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: Deno.env.get('ZOHO_CLIENT_ID')!,
      client_secret: Deno.env.get('ZOHO_CLIENT_SECRET')!, refresh_token: data.refresh_token }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`zoho_refresh_failed:${j.error || r.status}`);
  return { token: String(j.access_token), apiDomain: String(data.api_domain), orgId: String(data.org_id) };
}

async function zjson(url: string, init: RequestInit) {
  let r = await fetch(url, init);
  if (r.status === 429) { await new Promise(x => setTimeout(x, 1200)); r = await fetch(url, init); }
  const body = await r.json().catch(() => ({}));
  return { r, body };
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function begin(db: ReturnType<typeof svc>, key: string, action: string, userId: string, payload: unknown) {
  const { data: old } = await db.from('zoho_write_operations').select('id,status,result_payload')
    .eq('idempotency_key', key).maybeSingle();
  if (old?.status === 'succeeded') return { done: true, result: old.result_payload };
  if (old?.id) {
    await db.from('zoho_write_operations').update({ status: 'running', request_payload: payload,
      requested_by: userId, result_payload: {}, last_error: null, started_at: new Date().toISOString(), finished_at: null }).eq('id', old.id);
  } else {
    const { error } = await db.from('zoho_write_operations').insert({ idempotency_key: key, action,
      requested_by: userId, status: 'running', request_payload: payload });
    if (error) throw new Error(`audit_begin:${error.message}`);
  }
  return { done: false };
}

async function finish(db: ReturnType<typeof svc>, key: string, status: 'succeeded'|'failed'|'partial', result: unknown, error?: string) {
  await db.from('zoho_write_operations').update({ status, result_payload: result,
    last_error: error || null, finished_at: new Date().toISOString() }).eq('idempotency_key', key);
}

const openingBalance = (s: unknown) => String(s || '').replace(/\s+/g, ' ').trim()
  .includes('\u0627\u0644\u0631\u0635\u064a\u062f \u0627\u0644\u0627\u0641\u062a\u062a\u0627\u062d\u064a');

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const db = svc();
  const user = await requireWriter(req, db);
  if (!user) return json({ error: 'forbidden' }, 403);
  let input: any = {};
  try { input = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const action = String(input.action || '');

  try {
    if (action === 'bank_preview' || action === 'bank_import') {
      const accountId = String(input.account_id || '');
      const { data: link } = await db.from('zoho_financial_account_links')
        .select('zoho_account_id,internal_bank_name,link_kind').eq('zoho_account_id', accountId).maybeSingle();
      if (!link?.internal_bank_name || link.link_kind !== 'bank') return json({ error: 'bank_account_not_linked' }, 400);
      let query = db.from('bank_transactions').select('id,dedup_key,txn_date,txn_at,reference,description,debit,credit,bank')
        .eq('bank', link.internal_bank_name).order('txn_at', { ascending: true }).limit(500);
      if (Array.isArray(input.transaction_ids) && input.transaction_ids.length) query = query.in('id', input.transaction_ids.map(String));
      const { data: txs, error } = await query;
      if (error) throw new Error(`bank_read:${error.message}`);
      const { data: prior } = await db.from('zoho_write_operations').select('request_payload')
        .eq('action', 'bank_statement_import').eq('status', 'succeeded').limit(1000);
      const imported = new Set((prior || []).flatMap((r: any) => r.request_payload?.transaction_ids || []).map(String));
      const fresh = (txs || []).filter((t: any) => !imported.has(String(t.id)) && (Number(t.debit) > 0 || Number(t.credit) > 0));
      const summary = { account_id: accountId, bank: link.internal_bank_name, count: fresh.length,
        deposits: fresh.reduce((s: number, t: any) => s + Number(t.credit || 0), 0),
        withdrawals: fresh.reduce((s: number, t: any) => s + Number(t.debit || 0), 0),
        duplicates: (txs || []).length - fresh.length,
        transactions: fresh.map((t: any) => ({ id: t.id, date: String(t.txn_at || t.txn_date || '').slice(0, 10),
          reference: t.reference, description: t.description, debit: Number(t.debit || 0), credit: Number(t.credit || 0) })) };
      if (action === 'bank_preview') return json({ ok: true, ...summary });
      if (!fresh.length) return json({ ok: true, skipped: 'nothing_new', ...summary });
      if (!Array.isArray(input.transaction_ids) || !input.transaction_ids.length) return json({ error: 'explicit_selection_required' }, 400);

      const ids = fresh.map((t: any) => String(t.id)).sort();
      const key = `bank_statement:${accountId}:${await sha256(ids.join(','))}`;
      const audit = await begin(db, key, 'bank_statement_import', user.id, { account_id: accountId, bank: link.internal_bank_name, transaction_ids: ids });
      if (audit.done) return json({ ok: true, idempotent: true, result: audit.result });
      const access = await accessToken(db);
      const dates = fresh.map((t: any) => String(t.txn_at || t.txn_date || '').slice(0, 10)).sort();
      const payload = { account_id: accountId, start_date: dates[0], end_date: dates[dates.length - 1],
        transactions: fresh.map((t: any) => ({ transaction_id: String(t.dedup_key || t.id),
          date: String(t.txn_at || t.txn_date || '').slice(0, 10), debit_or_credit: Number(t.credit) > 0 ? 'credit' : 'debit',
          amount: Number(t.credit) > 0 ? Number(t.credit) : Number(t.debit), payee: '',
          description: String(t.description || ''), reference_number: String(t.reference || '') })) };
      const url = `${access.apiDomain}/books/v3/bankstatements?organization_id=${encodeURIComponent(access.orgId)}`;
      const z = await zjson(url, { method: 'POST', headers: { Authorization: `Zoho-oauthtoken ${access.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!z.r.ok || z.body.code !== 0) { const msg = String(z.body.message || z.r.status); await finish(db, key, 'failed', z.body, msg); return json({ error: msg, needs_reauthorization: /authori|scope|permission/i.test(msg) }, 400); }
      await finish(db, key, 'succeeded', { zoho: z.body, count: fresh.length, transaction_ids: ids });
      return json({ ok: true, count: fresh.length, deposits: summary.deposits, withdrawals: summary.withdrawals, zoho: z.body });
    }

    if (action === 'invoice_mark_sent' || action === 'invoice_push_zatca') {
      const ids = [...new Set((input.invoice_ids || []).map(String))].slice(0, 100);
      if (!ids.length) return json({ error: 'invoice_ids_required' }, 400);
      const { data: invoices, error } = await db.from('zoho_invoices')
        .select('zoho_id,invoice_number,customer_name,date,total,status,einvoice_status').in('zoho_id', ids);
      if (error) throw new Error(`invoice_read:${error.message}`);
      const access = await accessToken(db);
      const headers = { Authorization: `Zoho-oauthtoken ${access.token}` };
      const results: any[] = [];
      for (const inv of invoices || []) {
        if (action === 'invoice_mark_sent' && String(inv.status).toLowerCase() !== 'draft') {
          results.push({ invoice_id: inv.zoho_id, number: inv.invoice_number, outcome: 'skipped', reason: 'not_draft' }); continue;
        }
        if (action === 'invoice_push_zatca' && openingBalance(inv.invoice_number)) {
          results.push({ invoice_id: inv.zoho_id, number: inv.invoice_number, outcome: 'excluded', reason: 'opening_balance' }); continue;
        }
        if (action === 'invoice_push_zatca' && String(inv.einvoice_status).toLowerCase() !== 'yet_to_be_pushed') {
          results.push({ invoice_id: inv.zoho_id, number: inv.invoice_number, outcome: 'skipped', reason: 'not_pending_zatca' }); continue;
        }
        const op = action === 'invoice_mark_sent' ? 'mark_sent' : 'zatca_push';
        const key = `${op}:${inv.zoho_id}`;
        const audit = await begin(db, key, action, user.id, { invoice_id: inv.zoho_id, invoice_number: inv.invoice_number });
        if (audit.done) { results.push({ invoice_id: inv.zoho_id, number: inv.invoice_number, outcome: 'skipped', reason: 'already_done' }); continue; }
        const path = action === 'invoice_mark_sent' ? `status/sent` : 'einvoice/push';
        const url = `${access.apiDomain}/books/v3/invoices/${inv.zoho_id}/${path}?organization_id=${encodeURIComponent(access.orgId)}`;
        const z = await zjson(url, { method: 'POST', headers });
        if (!z.r.ok || z.body.code !== 0) {
          const msg = String(z.body.message || z.r.status); await finish(db, key, 'failed', z.body, msg);
          results.push({ invoice_id: inv.zoho_id, number: inv.invoice_number, outcome: 'failed', error: msg });
        } else {
          await finish(db, key, 'succeeded', z.body);
          if (action === 'invoice_mark_sent') await db.from('zoho_invoices').update({ status: 'sent' }).eq('zoho_id', inv.zoho_id);
          results.push({ invoice_id: inv.zoho_id, number: inv.invoice_number, outcome: 'succeeded', message: z.body.message });
        }
      }
      const failed = results.filter(x => x.outcome === 'failed').length;
      return json({ ok: failed === 0, succeeded: results.filter(x => x.outcome === 'succeeded').length,
        skipped: results.filter(x => ['skipped','excluded'].includes(x.outcome)).length, failed, results }, failed ? 207 : 200);
    }

    if (action === 'webhook_failures') {
      const { data, error } = await db.from('zoho_webhook_inbox')
        .select('event_key,event_type,entity_type,entity_id,status,attempts,received_at,last_error')
        .in('status', ['failed','processing']).order('received_at', { ascending: false }).limit(100);
      if (error) throw new Error(error.message);
      return json({ ok: true, rows: data || [] });
    }
    if (action === 'webhook_retry') {
      const key = String(input.event_key || '');
      const { data: event } = await db.from('zoho_webhook_inbox').select('entity_type,entity_id,attempts').eq('event_key', key).maybeSingle();
      if (!event?.entity_id) return json({ error: 'event_not_found' }, 404);
      // A targeted mirror refresh is safer than replaying an untrusted raw payload.
      await db.from('zoho_webhook_inbox').update({ status: 'processing', attempts: Number(event.attempts || 0) + 1,
        processing_started_at: new Date().toISOString(), last_error: null }).eq('event_key', key);
      const sync = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/zoho-sync`, {
        method: 'POST', headers: { Authorization: req.headers.get('Authorization') || '',
          apikey: Deno.env.get('SUPABASE_ANON_KEY')!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync', force: true }),
      });
      const syncBody = await sync.json().catch(() => ({}));
      const ok = sync.ok && syncBody?.ok !== false;
      await db.from('zoho_webhook_inbox').update({ status: ok ? 'processed' : 'failed',
        processed_at: ok ? new Date().toISOString() : null,
        last_error: ok ? null : String(syncBody?.error || sync.status) }).eq('event_key', key);
      return json({ ok, entity_type: event.entity_type, entity_id: event.entity_id, sync: syncBody }, ok ? 200 : 502);
    }
    return json({ error: 'unknown_action' }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
