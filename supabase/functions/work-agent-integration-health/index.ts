import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { intervalBucketKey } from '../_shared/idempotency.ts';

const cors = {
  'Access-Control-Allow-Origin': 'https://shipaudit-five.vercel.app',
  'Access-Control-Allow-Headers': 'authorization,x-client-info,apikey,content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const input = await req.json().catch(() => ({}));
  const { data: secret } = await db.from('zoho_auth').select('cron_key').eq('id', 1).maybeSingle();
  const cron = !!secret?.cron_key && req.headers.get('x-cron-key') === secret.cron_key;
  let userId: string | null = null;
  if (!cron) {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await db.auth.getUser(token);
    userId = user?.id || null;
    if (!userId) return json({ ok: false, error: 'unauthorized' }, 401);
    const { data: profile } = await db.from('profiles').select('role,permissions').eq('id', userId).maybeSingle();
    const permission = input.action === 'preview' ? 'agents.view' : 'agents.run';
    if (profile?.role !== 'admin' && !profile?.permissions?.[permission]) return json({ ok: false, error: 'forbidden' }, 403);
  }

  const { data: agent, error: agentError } = await db.from('work_agents').select('*').eq('agent_key', 'integration_health').single();
  if (agentError) return json({ ok: false, error: agentError.message }, 500);
  if (cron && agent.status !== 'active') return json({ ok: true, skipped: true, reason: 'paused' });
  const config = agent.config || {};
  const { data: snapshot, error } = await db.rpc('integration_health_snapshot', {
    p_zoho_minutes: Number(config.zoho_max_age_minutes || 90),
    p_hatif_minutes: Number(config.hatif_max_age_minutes || 20),
    p_platform_hours: Number(config.platform_max_age_hours || 72),
  });
  if (error) return json({ ok: false, error: error.message }, 500);
  if (input.action === 'preview') return json({ ok: true, preview: true, snapshot });

  const issues = Number(snapshot.issue_count || 0);
  const sources = ['zoho', 'hatif', 'platform', 'lead_intake', 'webhooks', 'zoho_runs', 'cron', 'vat', 'zoho_api'];
  const healthy = sources.filter((key) => snapshot[key]?.healthy).length;
  const summary = issues === 1
    ? `فحص واحد يحتاج مراجعة · ${healthy} سليمة`
    : issues ? `تحتاج ${issues} فحوص إلى مراجعة · ${healthy} سليمة` : 'الفحوص التسعة سليمة';
  const now = new Date();
  const intervalMinutes = Number(config.interval_minutes || 360);
  const nextRun = new Date(now.getTime() + intervalMinutes * 60_000);
  const runKey = `work-agent:integration-health:${intervalBucketKey(now, intervalMinutes)}`;
  const { data: run, error: runError } = await db.rpc('create_idempotent_work_agent_run', {
    p_agent_id: agent.id,
    p_idempotency_key: runKey,
    p_status: issues ? 'partial' : 'succeeded',
    p_trigger_type: cron ? 'schedule' : 'manual',
    p_finished_at: now.toISOString(),
    p_checked_count: sources.length,
    p_action_count: 0,
    p_failed_count: issues,
    p_summary: summary,
    p_details: { report_type: 'integration_health', snapshot },
    p_approved_by: userId,
    p_next_run_at: nextRun.toISOString(),
  });
  if (runError) return json({ ok: false, error: runError.message }, 500);
  return json({ ok: true, run_id: run?.run_id, duplicate: run?.inserted !== true, summary, snapshot });
});
