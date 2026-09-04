import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const foundationMigration = fs.readFileSync(
  new URL('../supabase/migrations/20260904024104_lamha_welcome_automation_dispatch.sql', import.meta.url),
  'utf8',
);
const configurationMigration = fs.readFileSync(
  new URL('../supabase/migrations/20260904024936_lamha_welcome_snapshot_dedupe_configuration.sql', import.meta.url),
  'utf8',
);
const activationMigration = fs.readFileSync(
  new URL('../supabase/migrations/20260904025414_activate_lamha_new_customer_welcome.sql', import.meta.url),
  'utf8',
);
const hardeningMigration = fs.readFileSync(
  new URL('../supabase/migrations/20260904025728_harden_welcome_template_variables.sql', import.meta.url),
  'utf8',
);
const arityMigration = fs.readFileSync(
  new URL('../supabase/migrations/20260904030414_enforce_masrah_template_arity.sql', import.meta.url),
  'utf8',
);
const fridayMigration = fs.readFileSync(
  new URL('../supabase/migrations/20260904032846_defer_friday_welcome_to_evening.sql', import.meta.url),
  'utf8',
);
const migration = `${foundationMigration}\n${configurationMigration}\n${activationMigration}\n${hardeningMigration}\n${arityMigration}\n${fridayMigration}`;
const lamha = fs.readFileSync(
  new URL('../supabase/functions/lamha-financial-guard/index.ts', import.meta.url),
  'utf8',
);
const campaignRunner = fs.readFileSync(
  new URL('../supabase/functions/campaign-runner/index.ts', import.meta.url),
  'utf8',
);

test('welcome automation executes only when the complete rule is explicitly active', () => {
  assert.match(migration, /status <> 'active'/);
  assert.match(migration, /execution_mode <> 'automatic'/);
  assert.match(migration, /template_variables_required/);
  assert.match(migration, /template_name = 'masrah'/);
  assert.match(configurationMigration, /active_automation_template_required/);
  assert.match(configurationMigration, /active_automation_variables_required/);
  assert.match(configurationMigration, /active_automation_successful_sync_required/);
  assert.match(hardeningMigration, /welcome_automation_two_variables_required/);
  assert.match(arityMigration, /welcome_automation_exactly_two_variables_required/);
  assert.match(activationMigration, /status = 'active'/);
  assert.match(activationMigration, /execution_mode = 'automatic'/);
  assert.match(activationMigration, /welcome_automation_activation_preconditions_failed/);
});

test('each successful Lamha sync hands only its accepted latest snapshot to automation', () => {
  const directoryAt = lamha.indexOf('const directory = await syncDirectory');
  const statementAt = lamha.indexOf('const statement = await syncStatementExport');
  const automationAt = lamha.indexOf("db.rpc('queue_lamha_welcome_automation'");
  assert.ok(directoryAt >= 0 && statementAt > directoryAt && automationAt > statementAt);
  assert.match(lamha, /p_snapshot_id: snapshotId/);
  assert.match(migration, /v_latest_snapshot <> p_snapshot_id/);
  assert.match(migration, /event_type = 'registered'/);
  assert.match(configurationMigration, /e\.snapshot_id = p_snapshot_id/);
});

test('welcome audience is one durable record per normalized phone in each snapshot', () => {
  assert.match(configurationMigration, /automation_dispatches_rule_snapshot_phone_uidx/);
  assert.match(configurationMigration, /\(rule_id, source_snapshot_id, phone\)/);
  assert.match(configurationMigration, /group by public\.norm_sa_phone\(e\.phone\)/);
  assert.match(configurationMigration, /audienceIdentity', 'normalized_phone'/);
  assert.match(configurationMigration, /dedupeMode', 'once_per_snapshot_phone'/);
  assert.match(configurationMigration, /on conflict do nothing/);
});

test('blocked and invalid phones cannot reach the queue while an older welcome does not block a new store', () => {
  assert.match(configurationMigration, /public\.no_whatsapp_phones\(\)/);
  assert.match(configurationMigration, /length\(public\.norm_sa_phone\(e\.phone\)\) >= 11/);
  assert.doesNotMatch(configurationMigration, /public\.whatsapp_campaign_sends sent/);
  assert.doesNotMatch(configurationMigration, /sent\.template_name = v_rule\.template_name/);
});

test('queued recipients carry stable automation references and fixed variables', () => {
  assert.match(migration, /'vars', d\.template_variables/);
  assert.match(migration, /'automation_dispatch_id', d\.id/);
  assert.match(migration, /'automation_run_id', d\.run_id/);
  assert.match(configurationMigration, /'idempotency_ref', 'automation:' \|\| d\.rule_id::text \|\| ':' \|\| d\.source_snapshot_id \|\| ':' \|\| d\.phone/);
  assert.match(migration, /'أتمتة: ترحيب العميل الجديد'/);
});

test('masrah fixed variables are stored exactly as approved', () => {
  assert.match(configurationMigration, /"value":"معاذ"/);
  assert.match(configurationMigration, /"value":"اتواصل معكم بخوص تسجيلكم في المنصه"/);
  assert.match(configurationMigration, /template_name = 'masrah'/);
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

test('Friday morning audience is retained and deferred by an editable Saudi-time policy', () => {
  assert.match(fridayMigration, /private\.automation_delivery_at/);
  assert.match(fridayMigration, /time zone 'Asia\/Riyadh'/);
  assert.match(fridayMigration, /extract\(isodow from v_local_now\) = 5/);
  assert.match(fridayMigration, /deferFridayMorning/);
  assert.match(fridayMigration, /fridayMorningCutoff/);
  assert.match(fridayMigration, /fridayDeferredUntil/);
  assert.match(fridayMigration, /v_local_target := v_local_now::date \+ v_friday_deferred/);
  assert.match(fridayMigration, /v_scheduled_at := private\.automation_delivery_at\(v_rule\.schedule_config, now\(\)\)/);
  assert.match(fridayMigration, /friday_morning_deferred/);
});

test('active Friday deferral rejects invalid windows instead of silently sending', () => {
  assert.match(fridayMigration, /validate_automation_schedule_policy/);
  assert.match(fridayMigration, /welcome_automation_invalid_send_window/);
  assert.match(fridayMigration, /welcome_automation_invalid_friday_deferral/);
  assert.match(fridayMigration, /v_deferred <= v_cutoff/);
  assert.match(fridayMigration, /v_deferred < v_start/);
  assert.match(fridayMigration, /v_deferred > v_end/);
});
