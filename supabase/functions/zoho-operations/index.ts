// Controlled Zoho Books writes: invoice lifecycle and bank statement import.
// Every action requires its own explicit permission, is idempotent, audited,
// and scoped to existing documents/accounts. It never creates an invoice or deletes data.
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

async function requirePermission(req: Request, db: ReturnType<typeof svc>, permission: string) {
  const auth = req.headers.get('Authorization') || '';
  const uc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await uc.auth.getUser();
  if (!user) return null;
  const { data: p } = await db.from('profiles').select('role,permissions').eq('id', user.id).maybeSingle();
  if (p?.role !== 'admin' && p?.permissions?.[permission] !== true) return null;
  return user;
}

async function requirePermissions(req: Request, db: ReturnType<typeof svc>, permissions: string[]) {
  const auth = req.headers.get('Authorization') || '';
  const uc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await uc.auth.getUser();
  if (!user) return null;
  const { data: p } = await db.from('profiles').select('role,permissions').eq('id', user.id).maybeSingle();
  if (p?.role !== 'admin' && permissions.some(permission => p?.permissions?.[permission] !== true)) return null;
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

async function zjson(url: string, init: RequestInit, options: { retryPortal?: boolean; timeoutMs?: number } = {}) {
  const attempts = options.retryPortal ? 2 : 2;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const r = await fetch(url, { ...init, signal: init.signal || AbortSignal.timeout(options.timeoutMs || 20_000) });
      const body = await r.json().catch(() => ({}));
      const retryable = r.status === 429 || (options.retryPortal && Number(body?.code) === 41051);
      if (retryable && attempt + 1 < attempts) {
        await new Promise(resolve => setTimeout(resolve, options.retryPortal ? 2_500 : 1_200));
        continue;
      }
      return { r, body };
    } catch (error) {
      if (attempt + 1 < attempts) {
        await new Promise(resolve => setTimeout(resolve, 1_200));
        continue;
      }
      const timeout = error instanceof DOMException && error.name === 'TimeoutError';
      return { r: { ok: false, status: timeout ? 504 : 502 }, body: {
        code: timeout ? 504 : 502,
        message: timeout ? 'انتهت مهلة استجابة زوهو. ستبقى الفاتورة معلقة لإعادة المحاولة.'
          : (error instanceof Error ? error.message : String(error)),
      } };
    }
  }
  return { r: { ok: false, status: 504 }, body: { code: 504, message: 'انتهت مهلة استجابة زوهو.' } };
}

const normalizedRef = (value: unknown) => String(value || '').trim().toLocaleLowerCase();
const localTxnDate = (t: any) => String(t?.txn_at || t?.txn_date || '').slice(0, 10);

async function lastImportedBankAnchor(access: { token: string; apiDomain: string; orgId: string }, accountId: string) {
  const url = `${access.apiDomain}/books/v3/bankaccounts/${encodeURIComponent(accountId)}/statement/lastimported?organization_id=${encodeURIComponent(access.orgId)}`;
  const z = await zjson(url, { method: 'GET', headers: { Authorization: `Zoho-oauthtoken ${access.token}` } });
  const message = String(z.body?.message || '');
  if (z.r.status === 404 || /no .*statement|not found/i.test(message)) return null;
  if (!z.r.ok || z.body?.code !== 0) throw new Error(`zoho_last_statement:${message || z.r.status}`);
  const statements = Array.isArray(z.body?.statement) ? z.body.statement : [];
  const transactions = statements.flatMap((statement: any) => Array.isArray(statement?.transactions)
    ? statement.transactions.map((transaction: any) => ({ ...transaction, statement_id: statement.statement_id })) : []);
  transactions.sort((a: any, b: any) => String(a.date || '').localeCompare(String(b.date || ''))
    || String(a.transaction_id || '').localeCompare(String(b.transaction_id || '')));
  const last = transactions.at(-1);
  if (!last) return null;
  return {
    date: String(last.date || '').slice(0, 10),
    reference: String(last.reference_number || ''),
    transactionId: String(last.transaction_id || ''),
    statementId: String(last.statement_id || ''),
    knownReferences: new Set(transactions.map((t: any) => normalizedRef(t.reference_number)).filter(Boolean)),
    knownTransactionIds: new Set(transactions.map((t: any) => String(t.transaction_id || '')).filter(Boolean)),
  };
}

async function latestZohoBankTransactionAnchor(access: { token: string; apiDomain: string; orgId: string }, accountId: string) {
  const url = `${access.apiDomain}/books/v3/banktransactions?organization_id=${encodeURIComponent(access.orgId)}&account_id=${encodeURIComponent(accountId)}&page=1&per_page=200`;
  const z = await zjson(url, { method: 'GET', headers: { Authorization: `Zoho-oauthtoken ${access.token}` } });
  if (!z.r.ok || z.body?.code !== 0) throw new Error(`zoho_bank_transactions:${String(z.body?.message || z.r.status)}`);
  const rows = (Array.isArray(z.body?.banktransactions) ? z.body.banktransactions : [])
    .filter((row: any) => !row.account_id || String(row.account_id) === accountId)
    .sort((a: any, b: any) => String(a.date || a.transaction_date || '').localeCompare(String(b.date || b.transaction_date || ''))
      || String(a.transaction_id || a.bank_transaction_id || '').localeCompare(String(b.transaction_id || b.bank_transaction_id || '')));
  const last = rows.at(-1);
  if (!last) return null;
  const reference = String(last.reference_number || last.reference || '');
  const transactionId = String(last.transaction_id || last.bank_transaction_id || '');
  return {
    date: String(last.date || last.transaction_date || '').slice(0, 10), reference, transactionId,
    statementId: '', source: 'latest_bank_transaction',
    knownReferences: new Set(rows.map((t: any) => normalizedRef(t.reference_number || t.reference)).filter(Boolean)),
    knownTransactionIds: new Set(rows.map((t: any) => String(t.transaction_id || t.bank_transaction_id || '')).filter(Boolean)),
  };
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

const liveEinvoiceStatus = (invoice: Record<string, unknown>) => {
  const details = invoice.einvoice_details && typeof invoice.einvoice_details === 'object'
    ? invoice.einvoice_details as Record<string, unknown>
    : {};
  return String(details.status || invoice.einvoice_status || invoice.e_invoice_status || '').toLowerCase();
};

async function getLiveInvoice(access: { token: string; apiDomain: string; orgId: string }, invoiceId: string) {
  const url = `${access.apiDomain}/books/v3/invoices/${encodeURIComponent(invoiceId)}?organization_id=${encodeURIComponent(access.orgId)}`;
  const z = await zjson(url, { method: 'GET', headers: { Authorization: `Zoho-oauthtoken ${access.token}` } });
  if (!z.r.ok || z.body?.code !== 0 || !z.body?.invoice) {
    throw new Error(`zoho_invoice_read:${String(z.body?.message || z.r.status)}`);
  }
  return z.body.invoice as Record<string, unknown>;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const db = svc();
  let input: any = {};
  try { input = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const action = String(input.action || '');
  const permissionByAction: Record<string, string> = {
    bank_preview: 'zoho.bank_import',
    bank_import: 'zoho.bank_import',
    invoice_mark_sent: 'zoho.invoice_mark_sent',
    invoice_push_zatca: 'zoho.invoice_push_zatca',
    invoice_finalize_and_push_zatca: 'zoho.invoice_mark_sent',
    webhook_failures: 'zoho.retry_webhook',
    webhook_retry: 'zoho.retry_webhook',
  };
  const requiredPermission = permissionByAction[action];
  if (!requiredPermission) return json({ error: 'unknown_action' }, 400);
  const requiredPermissions = action === 'invoice_finalize_and_push_zatca'
    ? ['zoho.invoice_mark_sent', 'zoho.invoice_push_zatca']
    : [requiredPermission];
  const user = requiredPermissions.length === 1
    ? await requirePermission(req, db, requiredPermission)
    : await requirePermissions(req, db, requiredPermissions);
  if (!user) return json({ error: 'forbidden', permissions: requiredPermissions }, 403);

  try {
    if (action === 'bank_preview' || action === 'bank_import') {
      const accountId = String(input.account_id || '');
      const { data: link } = await db.from('zoho_financial_account_links')
        .select('zoho_account_id,internal_bank_name,link_kind').eq('zoho_account_id', accountId).maybeSingle();
      if (!link?.internal_bank_name || link.link_kind !== 'bank') return json({ error: 'bank_account_not_linked' }, 400);
      let query = db.from('bank_transactions').select('id,dedup_key,txn_date,txn_at,reference,description,debit,credit,bank')
        .eq('bank', link.internal_bank_name).order('txn_date', { ascending: false }).order('id', { ascending: false }).limit(1000);
      if (Array.isArray(input.transaction_ids) && input.transaction_ids.length) query = query.in('id', input.transaction_ids.map(String));
      const { data: txs, error } = await query;
      if (error) throw new Error(`bank_read:${error.message}`);
      const { data: prior } = await db.from('zoho_write_operations').select('request_payload')
        .eq('action', 'bank_statement_import').eq('status', 'succeeded').limit(1000);
      const imported = new Set((prior || []).flatMap((r: any) => r.request_payload?.transaction_ids || []).map(String));
      const ordered = [...(txs || [])].sort((a: any, b: any) => localTxnDate(a).localeCompare(localTxnDate(b))
        || String(a.id).localeCompare(String(b.id)));
      const access = await accessToken(db);
      const { data: manualAnchor } = await db.from('zoho_bank_import_anchors')
        .select('reference_number,anchor_date,local_transaction_id').eq('zoho_account_id', accountId).maybeSingle();
      const importedStatementAnchor = manualAnchor ? null : await lastImportedBankAnchor(access, accountId);
      const anchor = manualAnchor ? {
        date: String(manualAnchor.anchor_date || '').slice(0, 10),
        reference: String(manualAnchor.reference_number || ''),
        transactionId: '', statementId: '', source: 'manual_reference',
        knownReferences: new Set([normalizedRef(manualAnchor.reference_number)].filter(Boolean)),
        knownTransactionIds: new Set<string>(),
      } : importedStatementAnchor || await latestZohoBankTransactionAnchor(access, accountId);
      // لا نعرض كامل التاريخ عند غياب مرساة زوهو؛ البداية الأولى تُنشأ في زوهو
      // أو بعد ظهور أول عملية بنكية هناك، ثم تعمل المعاينة من المرجع التالي.
      let afterAnchor = anchor ? ordered : [];
      let anchorMatchedLocally = false;
      if (anchor) {
        const anchorIndex = ordered.findLastIndex((t: any) =>
          (anchor.transactionId && String(t.dedup_key || '') === anchor.transactionId)
          || (anchor.reference && normalizedRef(t.reference) === normalizedRef(anchor.reference)));
        if (anchorIndex >= 0) {
          anchorMatchedLocally = true;
          afterAnchor = ordered.slice(anchorIndex + 1);
        } else {
          // قد يبدأ الملف المحلي بعد آخر كشف زوهو. نبقي يوم المرساة لاستيعاب
          // عمليات أحدث في اليوم نفسه، ونستبعد كل ما يعرفه آخر كشف بالمعرّف/المرجع.
          afterAnchor = ordered.filter((t: any) => !anchor.date || localTxnDate(t) >= anchor.date)
            .filter((t: any) => !anchor.knownTransactionIds.has(String(t.dedup_key || ''))
              && !anchor.knownReferences.has(normalizedRef(t.reference)));
        }
      }
      const fresh = afterAnchor.filter((t: any) => !imported.has(String(t.id)) && (Number(t.debit) > 0 || Number(t.credit) > 0));
      const summary = { account_id: accountId, bank: link.internal_bank_name, count: fresh.length,
        deposits: fresh.reduce((s: number, t: any) => s + Number(t.credit || 0), 0),
        withdrawals: fresh.reduce((s: number, t: any) => s + Number(t.debit || 0), 0),
        duplicates: ordered.length - fresh.length,
        history_excluded: ordered.length - afterAnchor.length,
        zoho_anchor: anchor ? { date: anchor.date, reference: anchor.reference,
          transaction_id: anchor.transactionId, statement_id: anchor.statementId,
          matched_locally: anchorMatchedLocally, source: anchor.source || 'last_imported_statement' } : null,
        anchor_required: !anchor,
        transactions: fresh.map((t: any) => ({ id: t.id, date: String(t.txn_at || t.txn_date || '').slice(0, 10),
          reference: t.reference, description: t.description, debit: Number(t.debit || 0), credit: Number(t.credit || 0) })) };
      if (action === 'bank_preview') return json({ ok: true, ...summary });
      if (!fresh.length) return json({ ok: true, skipped: 'nothing_new', ...summary });
      if (!Array.isArray(input.transaction_ids) || !input.transaction_ids.length) return json({ error: 'explicit_selection_required' }, 400);

      const ids = fresh.map((t: any) => String(t.id)).sort();
      const key = `bank_statement:${accountId}:${await sha256(ids.join(','))}`;
      const audit = await begin(db, key, 'bank_statement_import', user.id, { account_id: accountId, bank: link.internal_bank_name, transaction_ids: ids });
      if (audit.done) return json({ ok: true, idempotent: true, result: audit.result });
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

    if (action === 'invoice_finalize_and_push_zatca') {
      const ids = [...new Set((input.invoice_ids || []).map(String))].slice(0, 100);
      if (!ids.length) return json({ error: 'invoice_ids_required' }, 400);
      const { data: invoices, error } = await db.from('zoho_invoices')
        .select('zoho_id,invoice_number,customer_name,date,total,status,einvoice_status').in('zoho_id', ids);
      if (error) throw new Error(`invoice_read:${error.message}`);
      const byId = new Map((invoices || []).map((invoice: any) => [String(invoice.zoho_id), invoice]));
      const access = await accessToken(db);
      const headers = { Authorization: `Zoho-oauthtoken ${access.token}` };
      const results: any[] = [];

      const processInvoice = async (invoiceId: string) => {
        const inv: any = byId.get(invoiceId);
        if (!inv) {
          return { invoice_id: invoiceId, outcome: 'failed', stage: 'read', error: 'invoice_not_found_in_mirror' };
        }
        if (openingBalance(inv.invoice_number)) {
          return { invoice_id: inv.zoho_id, number: inv.invoice_number, outcome: 'excluded', reason: 'opening_balance' };
        }

        let live: Record<string, unknown>;
        try {
          live = await getLiveInvoice(access, String(inv.zoho_id));
        } catch (error) {
          return { invoice_id: inv.zoho_id, number: inv.invoice_number, outcome: 'failed', stage: 'live_check',
            error: error instanceof Error ? error.message : String(error) };
        }

        let liveDocumentStatus = String(live.status || inv.status || '').toLowerCase();
        let liveZatcaStatus = liveEinvoiceStatus(live);
        let markedSent = liveDocumentStatus !== 'draft';
        let pushed = false;

        if (['pushed', 'reported', 'cleared'].includes(liveZatcaStatus)) {
          await db.from('zoho_invoices').update({ status: liveDocumentStatus || 'sent', einvoice_status: liveZatcaStatus }).eq('zoho_id', inv.zoho_id);
          return { invoice_id: inv.zoho_id, number: inv.invoice_number, outcome: 'succeeded',
            marked_sent: markedSent, pushed: false, reason: 'already_pushed', live_zatca_status: liveZatcaStatus };
        }
        if (liveZatcaStatus !== 'yet_to_be_pushed') {
          return { invoice_id: inv.zoho_id, number: inv.invoice_number, outcome: 'failed', stage: 'readiness',
            marked_sent: markedSent, error: `zatca_not_ready:${liveZatcaStatus || 'status_unavailable'}` };
        }

        const pushKey = `zatca_push:${inv.zoho_id}`;
        const audit = await begin(db, pushKey, 'invoice_push_zatca', user.id,
          { invoice_id: inv.zoho_id, invoice_number: inv.invoice_number, parent_action: action });
        if (!audit.done) {
          const pushUrl = `${access.apiDomain}/books/v3/invoices/${inv.zoho_id}/einvoice/push?organization_id=${encodeURIComponent(access.orgId)}`;
          const pushedResponse = await zjson(pushUrl, { method: 'POST', headers }, { retryPortal: true, timeoutMs: 15_000 });
          if (!pushedResponse.r.ok || pushedResponse.body?.code !== 0) {
            const message = String(pushedResponse.body?.message || pushedResponse.r.status);
            await finish(db, pushKey, 'failed', pushedResponse.body, message);
            return { invoice_id: inv.zoho_id, number: inv.invoice_number, outcome: 'failed', stage: 'zatca_push',
              marked_sent: markedSent, retryable: Number(pushedResponse.body?.code) === 41051 || Number(pushedResponse.body?.code) === 504,
              error: message };
          }
          await finish(db, pushKey, 'succeeded', pushedResponse.body);
        }
        pushed = true;

        // Saudi e-invoices cannot be marked sent before they are submitted to
        // Fatoora (Zoho code 41016). Push first, then re-read the live document.
        let postPushWarning = '';
        for (let attempt = 0; attempt < 4; attempt += 1) {
          if (attempt) await new Promise(resolve => setTimeout(resolve, 700));
          try {
            live = await getLiveInvoice(access, String(inv.zoho_id));
            liveDocumentStatus = String(live.status || liveDocumentStatus).toLowerCase();
            liveZatcaStatus = liveEinvoiceStatus(live) || 'pushed';
            if (['pushed', 'reported', 'cleared'].includes(liveZatcaStatus)) break;
          } catch (error) {
            postPushWarning = error instanceof Error ? error.message : String(error);
          }
        }

        if (liveDocumentStatus === 'draft') {
          const markKey = `mark_sent:${inv.zoho_id}`;
          const markAudit = await begin(db, markKey, 'invoice_mark_sent', user.id,
            { invoice_id: inv.zoho_id, invoice_number: inv.invoice_number, parent_action: action, after_zatca_push: true });
          if (!markAudit.done) {
            const markUrl = `${access.apiDomain}/books/v3/invoices/${inv.zoho_id}/status/sent?organization_id=${encodeURIComponent(access.orgId)}`;
            const marked = await zjson(markUrl, { method: 'POST', headers });
            if (!marked.r.ok || marked.body?.code !== 0) {
              postPushWarning = String(marked.body?.message || marked.r.status);
              await finish(db, markKey, 'failed', marked.body, postPushWarning);
            } else {
              await finish(db, markKey, 'succeeded', marked.body);
              liveDocumentStatus = 'sent';
              markedSent = true;
            }
          } else {
            liveDocumentStatus = 'sent';
            markedSent = true;
          }
        } else {
          markedSent = true;
        }

        await db.from('zoho_invoices').update({ status: liveDocumentStatus || inv.status,
          einvoice_status: ['pushed', 'reported', 'cleared'].includes(liveZatcaStatus) ? liveZatcaStatus : 'pushed' })
          .eq('zoho_id', inv.zoho_id);
        return { invoice_id: inv.zoho_id, number: inv.invoice_number, outcome: 'succeeded',
          marked_sent: markedSent, pushed, warning: postPushWarning || undefined,
          message: markedSent ? 'pushed_and_marked_sent' : 'pushed' };
      };

      // Two invoices at a time keep the request bounded without flooding Zoho's
      // Fatoora gateway. Results are restored to the user's selection order.
      for (let offset = 0; offset < ids.length; offset += 2) {
        const chunk = ids.slice(offset, offset + 2);
        results.push(...await Promise.all(chunk.map(processInvoice)));
      }

      const failed = results.filter(result => result.outcome === 'failed').length;
      const succeeded = results.filter(result => result.outcome === 'succeeded').length;
      const skipped = results.filter(result => ['skipped', 'excluded'].includes(result.outcome)).length;
      return json({ ok: failed === 0, succeeded, skipped, failed, results }, failed ? 207 : 200);
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
