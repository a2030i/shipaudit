import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20260815204621_customer_growth_operating_loop.sql', import.meta.url), 'utf8');
const hardening = readFileSync(new URL('../supabase/migrations/20260815204800_harden_customer_growth_rpc_boundary.sql', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/lib/nextActionsService.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/pages/NextActions.jsx', import.meta.url), 'utf8');
const customer360 = readFileSync(new URL('../src/pages/CustomerWatch.jsx', import.meta.url), 'utf8');

test('growth loop unifies identity, lifecycle, ownership and measured outcomes', () => {
  assert.match(migration, /customer_growth_operating_snapshot/);
  assert.match(migration, /customer_growth_profile/);
  assert.match(migration, /customer_merchant_links/);
  assert.match(migration, /merchant_lifecycle_events/);
  assert.match(migration, /customers_paid_after_touch/);
  assert.match(migration, /shipping_after_touch/);
  assert.match(migration, /activation_rate_pct/);
});

test('reviewed outcomes are append-only, permission checked and preserve financial holds', () => {
  assert.match(migration, /create table if not exists public\.customer_growth_outcomes/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.customer_growth_outcomes from public, anon, authenticated/);
  assert.match(migration, /record_customer_growth_outcome/);
  assert.match(migration, /next_action_required/);
  assert.match(migration, /v_financial_hold/);
  assert.match(migration, /if not v_financial_hold then/);
  assert.doesNotMatch(migration, /hatif-send|sendWhatsAppCampaign|campaign_queue/);
});

test('privileged implementations stay private behind security-invoker RPC wrappers', () => {
  assert.match(hardening, /set schema private/);
  assert.match(hardening, /security invoker/);
  assert.match(hardening, /customer_growth_outcomes_recorded_by_idx/);
  assert.match(hardening, /revoke all on function private\.record_customer_growth_outcome/);
});

test('action queue suppresses completed and future-scheduled work without enabling sends', () => {
  assert.match(migration, /customer_growth_action_queue/);
  assert.match(migration, /outcome\.next_action_at <= now\(\)/);
  assert.match(migration, /outcome\.sales_stage not in \('won', 'lost'\)/);
  assert.match(service, /customer_growth_action_queue/);
  assert.match(service, /customer_growth_operating_snapshot/);
  assert.match(service, /customer_growth_profile/);
});

test('customer workbench requires a next action and opens the unified 360 profile', () => {
  assert.match(page, /حلقة نمو العملاء/);
  assert.match(page, /موعد الإجراء التالي/);
  assert.match(page, /recordCustomerGrowthOutcome/);
  assert.match(page, /CustomerGrowthProfile/);
  assert.doesNotMatch(page, /setRetargetingFollowup/);
  assert.match(customer360, /params\.get\('open'\) !== '1'/);
});
