import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('automation operating model makes recipient, action, risk and approval explicit', async () => {
  const migration = await read('supabase/migrations/20260904081500_automation_operating_model.sql');
  for (const field of ['audience_type', 'action_type', 'action_config', 'risk_level', 'approval_policy']) {
    assert.match(migration, new RegExp(`add column if not exists ${field}`));
  }
  assert.match(migration, /automation_capabilities/);
  assert.match(migration, /critical_automation_cannot_be_automatic/);
  assert.match(migration, /account_action_requires_explicit_each_run/);
  assert.match(migration, /employee_notification_recipient_strategy_required/);
});

test('management brief is internal and scheduled every 12 hours', async () => {
  const migration = await read('supabase/migrations/20260904081500_automation_operating_model.sql');
  const fn = await read('supabase/functions/work-agent-management-report/index.ts');
  assert.match(migration, /management_operating_brief_12h/);
  assert.match(migration, /cron_expression='0 6,18 \* \* \*'/);
  assert.match(migration, /"delivery":"in_app","externalWrite":false/);
  assert.match(fn, /report_type:'management_12h'/);
  assert.match(fn, /utcHour<6/);
  assert.doesNotMatch(fn, /sendTemplate|hatif-send|lamha-store-status/);
});

test('staff agents stay drafts until staff template and ownership are documented', async () => {
  const migration = await read('supabase/migrations/20260904081500_automation_operating_model.sql');
  assert.match(migration, /new_customer_sales_staff_alert/);
  assert.match(migration, /stopped_customer_retention_staff_alert/);
  assert.match(migration, /'sales','draft','preview','new_customer'/);
  assert.match(migration, /'retention','draft','preview','stopped_shipping'/);
  assert.match(migration, /assigned_sales_owner/);
  assert.match(migration, /assigned_retention_owner/);
});

test('control center renders a shared workflow map and does not imply preview executed an action', async () => {
  const component = await read('src/components/automation/AutomationControlCenter.jsx');
  assert.match(component, /خريطة التشغيل الموحدة/);
  assert.match(component, /المحفز.*الشروط.*الجمهور.*الإجراء.*التحقق.*السجل/s);
  assert.match(component, /لا تتحول إلى إرسال أو إيقاف/);
  assert.match(component, /loadAutomationCapabilities/);
});

test('management schedule configuration keeps privileged cron writes outside the exposed API schema', async () => {
  const migration = await read('supabase/migrations/20260904091000_harden_management_agent_configuration.sql');
  assert.match(migration, /private\.configure_management_report_agent/);
  assert.match(migration, /create or replace function public\.configure_management_report_agent/);
  assert.match(migration, /language sql\s+security invoker/);
  assert.match(migration, /set search_path=''/);
  assert.match(migration, /revoke all on function public\.configure_management_report_agent[\s\S]*from public,anon/);
});

test('work-agent actor foreign keys have covering indexes', async () => {
  const migration = await read('supabase/migrations/20260904092500_index_work_agent_fks.sql');
  assert.match(migration, /work_agent_runs_approved_by_idx/);
  assert.match(migration, /work_agents_created_by_idx/);
});

test('ZATCA schedule configuration uses the same private privileged boundary', async () => {
  const migration = await read('supabase/migrations/20260904094000_harden_zatca_agent_configuration.sql');
  assert.match(migration, /private\.configure_zatca_work_agent/);
  assert.match(migration, /create or replace function public\.configure_zatca_work_agent/);
  assert.match(migration, /language sql\s+security invoker/);
  assert.match(migration, /exclude_opening_balances',true,'live_check_before_push',true/);
});
