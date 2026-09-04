import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260904024104_lamha_welcome_automation_dispatch.sql', import.meta.url),
  'utf8',
);
const lamha = fs.readFileSync(
  new URL('../supabase/functions/lamha-financial-guard/index.ts', import.meta.url),
  'utf8',
);
const campaignRunner = fs.readFileSync(
  new URL('../supabase/functions/campaign-runner/index.ts', import.meta.url),
  'utf8',
);

test('welcome automation stays inert until the complete rule is explicitly active', () => {
  assert.match(migration, /status <> 'active'/);
  assert.match(migration, /execution_mode <> 'automatic'/);
  assert.match(migration, /template_variables_required/);
  assert.match(migration, /template_name = 'masrah'/);
  assert.match(migration, /status = 'preview'/);
  assert.match(migration, /execution_mode = 'preview'/);
});

test('each successful Lamha sync hands only its accepted latest snapshot to automation', () => {
  const directoryAt = lamha.indexOf('const directory = await syncDirectory');
  const statementAt = lamha.indexOf('const statement = await syncStatementExport');
  const automationAt = lamha.indexOf("db.rpc('queue_lamha_welcome_automation'");
  assert.ok(directoryAt >= 0 && statementAt > directoryAt && automationAt > statementAt);
  assert.match(lamha, /p_snapshot_id: snapshotId/);
  assert.match(migration, /v_latest_snapshot <> p_snapshot_id/);
  assert.match(migration, /event_type = 'registered'/);
  assert.match(migration, /observed_at >= now\(\) - make_interval\(hours => v_lookback\)/);
});

test('welcome audience is one durable record per normalized phone', () => {
  assert.match(migration, /unique \(rule_id, phone\)/);
  assert.match(migration, /group by public\.norm_sa_phone\(e\.phone\)/);
  assert.match(migration, /audienceIdentity', 'normalized_phone'/);
  assert.match(migration, /dedupeMode', 'once_per_phone_ever'/);
  assert.match(migration, /on conflict do nothing/);
});

test('blocked, invalid and previously welcomed phones cannot reach the queue', () => {
  assert.match(migration, /public\.no_whatsapp_phones\(\)/);
  assert.match(migration, /length\(public\.norm_sa_phone\(e\.phone\)\) >= 11/);
  assert.match(migration, /public\.whatsapp_campaign_sends sent/);
  assert.match(migration, /sent\.template_name = v_rule\.template_name/);
});

test('queued recipients carry stable automation references and fixed variables', () => {
  assert.match(migration, /'vars', d\.template_variables/);
  assert.match(migration, /'automation_dispatch_id', d\.id/);
  assert.match(migration, /'automation_run_id', d\.run_id/);
  assert.match(migration, /'idempotency_ref', 'automation:' \|\| d\.rule_id::text \|\| ':' \|\| d\.phone/);
  assert.match(migration, /'أتمتة: ترحيب العميل الجديد'/);
});

test('campaign delivery writes every terminal result back to the automation audit trail', () => {
  assert.match(campaignRunner, /finishAutomationDispatch/);
  assert.match(campaignRunner, /'sent'/);
  assert.match(campaignRunner, /'failed'/);
  assert.match(campaignRunner, /'skipped'/);
  assert.match(campaignRunner, /'unknown'/);
  assert.match(campaignRunner, /refreshAutomationRun/);
  assert.match(campaignRunner, /deliveryCounts/);
});

test('welcome queue failure never corrupts a valid Lamha sync', () => {
  assert.match(lamha, /welcomeAutomation/);
  assert.match(lamha, /Hatif automation is intentionally failure-isolated/);
  assert.match(lamha, /data: \{ directory, statement, welcomeAutomation \}/);
  assert.doesNotMatch(lamha, /welcomeAutomation[\s\S]{0,200}throw error/);
});
