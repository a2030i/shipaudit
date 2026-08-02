// zatca-auto-push — submits eligible Zoho Books invoices to ZATCA/Fatoora
// through Zoho's own Phase-2 integration. Invoked daily at 23:45 Riyadh time
// (20:45 UTC) by pg_cron, or manually by an admin for preview/verification.
//
// Security: verify_jwt is disabled only because pg_cron has no user JWT. Every
// request must present the rotating X-Cron-Key stored in zoho_auth, or a real
// authenticated admin token. The service-role key never leaves the function.
import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_ORIGIN = 'https://shipaudit-five.vercel.app';
const CORS = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' },
});
const db = () => createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

type Candidate = {
  zoho_id: string;
  invoice_number: string | null;
  customer_name: string | null;
  date: string | null;
  total: number | null;
  einvoice_status: string | null;
};

async function authorize(req: Request, service: ReturnType<typeof db>, action: string) {
  const cronKey = req.headers.get('X-Cron-Key') || req.headers.get('x-cron-key');
  if (cronKey) {
    const { data } = await service.from('zoho_auth').select('cron_key').eq('id', 1).maybeSingle();
    if (data?.cron_key && data.cron_key === cronKey) return { ok: true, cron: true, userId: null };
  }

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return { ok: false, cron: false, userId: null };
  const { data: auth } = await service.auth.getUser(token);
  if (!auth?.user) return { ok: false, cron: false, userId: null };
  const { data: profile } = await service.from('profiles').select('role,permissions').eq('id', auth.user.id).maybeSingle();
  const permission = action === 'preview' ? 'agents.view' : 'agents.approve_sensitive';
  return { ok: profile?.role === 'admin' || !!profile?.permissions?.[permission], cron: false, userId: auth.user.id };
}

async function getZohoAccess(service: ReturnType<typeof db>) {
  const { data } = await service.from('zoho_auth').select('*').eq('id', 1).maybeSingle();
  if (!data?.refresh_token) throw new Error('zoho_not_connected');
  const response = await fetch(`https://${data.accounts_domain}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: Deno.env.get('ZOHO_CLIENT_ID')!,
      client_secret: Deno.env.get('ZOHO_CLIENT_SECRET')!,
      refresh_token: data.refresh_token,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(`zoho_refresh_failed:${payload.error || response.status}`);
  }
  return {
    token: String(payload.access_token),
    apiDomain: String(data.api_domain),
    orgId: String(data.org_id),
  };
}

async function zohoJson(url: string, init: RequestInit) {
  let response = await fetch(url, init);
  if (response.status === 429) {
    await new Promise(resolve => setTimeout(resolve, 1200));
    response = await fetch(url, init);
  }
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function liveStatus(invoice: Record<string, unknown>) {
  const details = invoice.einvoice_details && typeof invoice.einvoice_details === 'object'
    ? invoice.einvoice_details as Record<string, unknown>
    : {};
  return String(details.status || invoice.einvoice_status || invoice.e_invoice_status || '').toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let input: Record<string, unknown> = {};
  try { input = await req.json(); } catch { /* empty cron body */ }
  const preview = input.action === 'preview';
  const service = db();
  const auth = await authorize(req, service, preview ? 'preview' : 'run');
  if (!auth.ok) return json({ error: 'unauthorized' }, 401);
  const { data: agent } = await service.from('work_agents').select('*').eq('agent_key', 'zatca_nightly').maybeSingle();
  if (auth.cron && agent?.status !== 'active') return json({ ok: true, skipped: true, reason: 'agent_paused' });
  const maxInvoices = Math.min(500, Math.max(1, Number(agent?.config?.max_invoices || 200)));
  const saudiDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

  // The mirror is synchronized throughout the day. A live GET immediately
  // before every write is the final authority and prevents duplicate pushes.
  const { data, error } = await service.from('zoho_invoices')
    .select('zoho_id, invoice_number, customer_name, date, total, einvoice_status')
    .eq('einvoice_status', 'yet_to_be_pushed')
    .lte('date', saudiDate)
    .order('date', { ascending: true })
    .limit(maxInvoices);
  if (error) return json({ error: `candidate_query_failed:${error.message}` }, 500);
  const pending = (data || []) as Candidate[];
  // Opening-balance documents are migration/accounting setup records, not new
  // sales invoices. Sending them to Fatoora would create a false tax event.
  // Unicode escapes keep this safeguard intact even when deployment tooling
  // crosses a Windows console with a non-UTF-8 code page.
  const openingBalanceLabel = '\u0627\u0644\u0631\u0635\u064a\u062f \u0627\u0644\u0627\u0641\u062a\u062a\u0627\u062d\u064a';
  const isOpeningBalance = (row: Candidate) => String(row.invoice_number || '')
    .replace(/\s+/g, ' ').trim().includes(openingBalanceLabel);
  const excluded = pending.filter(isOpeningBalance).map(row => ({
    ...row, exclusion_reason: 'opening_balance_requires_manual_review',
  }));
  let candidates = pending.filter(row => !isOpeningBalance(row));

  if (preview) {
    let access: Awaited<ReturnType<typeof getZohoAccess>>;
    try { access = await getZohoAccess(service); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ error: message }, 502);
    }

    const verified: Candidate[] = [];
    const synchronized: Array<Candidate & { live_status: string }> = [];
    const verificationFailed: Array<Candidate & { exclusion_reason: string }> = [];
    const headers = { Authorization: `Zoho-oauthtoken ${access.token}` };
    const query = new URLSearchParams({ organization_id: access.orgId });

    // A preview is an approval surface, so the local mirror is not sufficient.
    // Check Zoho live and repair stale mirror statuses before showing candidates.
    for (const invoice of candidates) {
      const checkUrl = `${access.apiDomain}/books/v3/invoices/${invoice.zoho_id}?${query}`;
      const checked = await zohoJson(checkUrl, { headers });
      if (!checked.response.ok || checked.payload.code !== 0) {
        verificationFailed.push({ ...invoice, exclusion_reason: 'live_verification_failed' });
        continue;
      }
      const status = liveStatus(checked.payload.invoice || {});
      if (status === 'yet_to_be_pushed') {
        verified.push(invoice);
        continue;
      }
      if (status) {
        await service.from('zoho_invoices').update({ einvoice_status: status }).eq('zoho_id', invoice.zoho_id);
        synchronized.push({ ...invoice, einvoice_status: status, live_status: status });
      } else {
        verificationFailed.push({ ...invoice, exclusion_reason: 'live_status_unavailable' });
      }
    }
    candidates = verified;
    return json({
      ok: true, preview: true, saudiDate, count: candidates.length,
      // Opening balances are an internal accounting safeguard. They are not
      // actionable ZATCA invoices, so do not surface them in the operator UI.
      excludedCount: verificationFailed.length,
      excluded: verificationFailed, invoices: candidates,
      ignoredOpeningBalanceCount: excluded.length,
      synchronizedCount: synchronized.length, synchronized,
    });
  }
  const { data: run } = await service.from('work_agent_runs').insert({
    agent_id: agent?.id, status: 'running', trigger_type: auth.cron ? 'schedule' : 'manual',
    checked_count: pending.length, approved_by: auth.userId,
    details: { saudi_date: saudiDate, excluded_count: excluded.length },
  }).select('id').maybeSingle();
  if (!candidates.length) {
    if (run?.id) await service.from('work_agent_runs').update({ status:'succeeded', finished_at:new Date().toISOString(), summary:'لا توجد فواتير معلقة لزاتكا' }).eq('id',run.id);
    if (agent?.id) await service.from('work_agents').update({ last_run_at:new Date().toISOString() }).eq('id',agent.id);
    return json({ ok: true, saudiDate, pushed: 0, skipped: 0, failed: 0, excludedCount: excluded.length, excluded, results: [] });
  }

  let access: Awaited<ReturnType<typeof getZohoAccess>>;
  try { access = await getZohoAccess(service); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (run?.id) await service.from('work_agent_runs').update({
      status:'failed', finished_at:new Date().toISOString(), failed_count:candidates.length,
      summary:'تعذر الاتصال بزوهو قبل الإرسال', details:{ error:message, candidates:candidates.length },
    }).eq('id',run.id);
    return json({ error: message }, 502);
  }

  const headers = { Authorization: `Zoho-oauthtoken ${access.token}` };
  const results: Record<string, unknown>[] = [];

  for (const invoice of candidates) {
    const key = `zatca_push:${invoice.zoho_id}`;
    const base = {
      invoice_id: invoice.zoho_id,
      invoice_number: invoice.invoice_number,
      customer_name: invoice.customer_name,
      invoice_date: invoice.date,
      total: Number(invoice.total || 0),
      trigger: 'cron_2345_riyadh',
    };

    const { data: old } = await service.from('zoho_write_operations')
      .select('id, status, result_payload').eq('idempotency_key', key).maybeSingle();
    if (old?.status === 'succeeded') {
      results.push({ ...base, outcome: 'skipped', reason: 'already_pushed_by_shipaudit' });
      continue;
    }

    if (old?.id) {
      await service.from('zoho_write_operations').update({
        status: 'running', request_payload: base, result_payload: {}, last_error: null,
        started_at: new Date().toISOString(), finished_at: null,
      }).eq('id', old.id);
    } else {
      const { error: insertError } = await service.from('zoho_write_operations').insert({
        idempotency_key: key, action: 'zatca_einvoice_push', status: 'running', request_payload: base,
      });
      if (insertError) {
        results.push({ ...base, outcome: 'failed', error: `audit_insert_failed:${insertError.message}` });
        continue;
      }
    }

    try {
      const query = new URLSearchParams({ organization_id: access.orgId });
      const checkUrl = `${access.apiDomain}/books/v3/invoices/${invoice.zoho_id}?${query}`;
      const checked = await zohoJson(checkUrl, { headers });
      if (!checked.response.ok || checked.payload.code !== 0) {
        throw new Error(`invoice_check:${checked.payload.message || checked.response.status}`);
      }

      const status = liveStatus(checked.payload.invoice || {});
      if (status && status !== 'yet_to_be_pushed') {
        await service.from('zoho_write_operations').update({
          status: 'succeeded', result_payload: { skipped: true, live_status: status },
          finished_at: new Date().toISOString(),
        }).eq('idempotency_key', key);
        await service.from('zoho_invoices').update({ einvoice_status: status }).eq('zoho_id', invoice.zoho_id);
        results.push({ ...base, outcome: 'skipped', reason: 'live_status_changed', live_status: status });
        continue;
      }

      const pushUrl = `${access.apiDomain}/books/v3/invoices/${invoice.zoho_id}/einvoice/push?${query}`;
      const pushed = await zohoJson(pushUrl, { method: 'POST', headers });
      if (!pushed.response.ok || pushed.payload.code !== 0) {
        const message = String(pushed.payload.message || pushed.payload.error || pushed.response.status);
        if (/scope|authori[sz]|permission/i.test(message)) {
          throw new Error(`reauthorization_required:${message}`);
        }
        throw new Error(`zatca_push_failed:${message}`);
      }

      await service.from('zoho_write_operations').update({
        status: 'succeeded', result_payload: pushed.payload,
        finished_at: new Date().toISOString(),
      }).eq('idempotency_key', key);
      await service.from('zoho_invoices').update({ einvoice_status: 'pushed' }).eq('zoho_id', invoice.zoho_id);
      results.push({ ...base, outcome: 'pushed', zoho_message: pushed.payload.message || null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await service.from('zoho_write_operations').update({
        status: 'failed', last_error: message, result_payload: { error: message },
        finished_at: new Date().toISOString(),
      }).eq('idempotency_key', key);
      results.push({ ...base, outcome: 'failed', error: message });
    }
  }

  const pushed = results.filter(row => row.outcome === 'pushed').length;
  const skipped = results.filter(row => row.outcome === 'skipped').length;
  const failed = results.filter(row => row.outcome === 'failed').length;
  if (run?.id) await service.from('work_agent_runs').update({
    status: failed ? (pushed ? 'partial' : 'failed') : 'succeeded', finished_at:new Date().toISOString(),
    action_count:pushed, failed_count:failed,
    summary:`أرسل ${pushed} فاتورة إلى زاتكا${failed ? ` · فشل ${failed}` : ''}`,
    details:{ saudi_date:saudiDate, candidates:candidates.length, pushed, skipped, failed, excluded_count:excluded.length },
  }).eq('id',run.id);
  if (agent?.id) await service.from('work_agents').update({ last_run_at:new Date().toISOString() }).eq('id',agent.id);
  console.log('zatca-auto-push completed', { saudiDate, candidates: candidates.length, pushed, skipped, failed });
  return json({
    ok: failed === 0, saudiDate, candidates: candidates.length, pushed, skipped, failed,
    excludedCount: excluded.length, excluded, results,
  }, failed ? 207 : 200);
});
