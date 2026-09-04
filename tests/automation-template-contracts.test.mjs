import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  templateContractIssue, variablesForContract,
} from '../src/lib/automationTemplateContracts.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const portalContract = {
  template_name: 'tahseel_portal_balance_v2', approved: true,
  variable_contract: [
    { position: 1, mode: 'field', source: 'field:name' },
    { position: 2, mode: 'field', source: 'field:full_amount' },
    { position: 3, mode: 'field', source: 'field:count' },
    { position: 4, mode: 'field', source: 'field:filtered_overdue_amount' },
    { position: 5, mode: 'field', source: 'field:aging_filter' },
  ],
};

test('approved dynamic template builds exact ordered field bindings', () => {
  const variables = variablesForContract(portalContract);
  assert.deepEqual(variables.map(item => [item.position, item.mode, item.source]), [
    [1, 'field', 'field:name'], [2, 'field', 'field:full_amount'], [3, 'field', 'field:count'],
    [4, 'field', 'field:filtered_overdue_amount'], [5, 'field', 'field:aging_filter'],
  ]);
  assert.equal(templateContractIssue(portalContract, variables), '');
});

test('template contract rejects missing, swapped and unapproved bindings', () => {
  const correct = variablesForContract(portalContract);
  assert.match(templateContractIssue(portalContract, correct.slice(0, 4)), /عدد المتغيرات/);
  assert.match(templateContractIssue(portalContract, correct.map(item => item.position === 4 ? { ...item, source: 'field:count' } : item)), /مصدر المتغير/);
  assert.match(templateContractIssue({ ...portalContract, approved: false }, correct), /غير معتمد/);
});

test('financial automation migration uses operational collectible and never queues or suspends', async () => {
  const migration = await read('supabase/migrations/20260904065217_financial_automation_template_contracts.sql');
  assert.match(migration, /automation_template_contracts/);
  assert.match(migration, /'tahseel_portal_balance_v2'/);
  assert.match(migration, /public\.customer_collectible_lines/);
  assert.match(migration, /l\.line_kind='invoice'/);
  assert.match(migration, /l\.collectible_amount>v_min_amount/);
  assert.match(migration, /p_rule\.event_type = 'financial_suspension_review'/);
  assert.match(migration, /l\.age_days>v_days/);
  assert.match(migration, /financial_suspension_automation_requires_explicit_external_approval/);
  assert.match(migration, /openingBalancePolicy":"excluded_pending_business_approval/);
  assert.doesNotMatch(migration, /insert into public\.campaign_queue/i);
  assert.doesNotMatch(migration, /lamha-store-status|\bpatch\b/i);
});

test('15-day reminder has exact approved five-variable contract and review mode', async () => {
  const migration = await read('supabase/migrations/20260904065217_financial_automation_template_contracts.sql');
  assert.match(migration, /status='review', execution_mode='review', template_name='tahseel_portal_balance_v2'/);
  for (const source of ['field:name','field:full_amount','field:count','field:filtered_overdue_amount','field:aging_filter']) {
    assert.match(migration, new RegExp(source.replace(':', '\\:')));
  }
});

test('authenticated preview can delegate only to guarded private helpers', async () => {
  const migration = await read('supabase/migrations/20260904071600_allow_guarded_automation_preview_helpers.sql');
  assert.match(migration, /grant execute on function private\.automation_preview_payload\(public\.automation_rules\) to authenticated/);
  assert.match(migration, /grant execute on function private\.financial_automation_preview_payload\(public\.automation_rules\) to authenticated/);
  assert.match(migration, /revoke execute .* from public, anon/);
  const foundation = await read('supabase/migrations/20260903192632_automation_rules_control_center.sql');
  const financial = await read('supabase/migrations/20260904065217_financial_automation_template_contracts.sql');
  assert.match(foundation, /app_has_any_permission\(array\['agents\.view'\]\)/);
  assert.match(financial, /app_has_any_permission\(array\['agents\.view'\]\)/);
});

test('lifecycle previews enforce freshness, registration wait and strict stopped age', async () => {
  const migration = await read('supabase/migrations/20260904073000_harden_lifecycle_automation_previews.sql');
  assert.match(migration, /source_at<now\(\)-\(v_source_hours\|\|' hours'\)::interval/);
  assert.match(migration, /first_registered::date<=current_date-v_days/);
  assert.match(migration, /last_shipment::date<current_date-v_days/);
  assert.match(migration, /w\.sent_at>=now\(\)-interval '24 hours'/);
  assert.match(migration, /not account_enabled/);
  assert.match(migration, /store_count>1/);
  assert.doesNotMatch(migration, /insert into public\.campaign_queue/i);
});
