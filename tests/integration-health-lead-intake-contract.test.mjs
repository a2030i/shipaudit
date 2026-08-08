import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20260807133000_monitor_campaign_lead_readiness.sql', import.meta.url),
  'utf8',
);
const worker = await readFile(
  new URL('../supabase/functions/work-agent-integration-health/index.ts', import.meta.url),
  'utf8',
);
const page = await readFile(new URL('../src/pages/WorkAgents.jsx', import.meta.url), 'utf8');

test('integration health requires a configured campaign lead recipient', () => {
  assert.match(migration, /where\s+accepts_campaign_leads\s+and/i);
  assert.match(migration, /lead_notification_phone/);
  assert.match(migration, /lead_recipients\s*>\s*0\s+and\s+lead_failed\s*=\s*0/);
});

test('integration agent and UI expose lead intake within the expanded nine checks', () => {
  assert.match(worker, /'lead_intake'/);
  assert.match(worker, /الفحوص التسعة سليمة/);
  assert.match(page, /استقبال عملاء الحملات/);
  assert.match(page, /configured_recipients/);
});

test('work agent dashboard counts the latest partial run as needing attention', () => {
  assert.match(page, /latestRunByAgent/);
  assert.match(page, /\['partial', 'failed', 'error'\]/);
  assert.match(page, /latestRun=\{latestRunByAgent\.get\(agent\.id\)\}/);
});
