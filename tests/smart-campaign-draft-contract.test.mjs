import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('smart campaign migration adds the two optional Hatif assignee fields only', async () => {
  const sql = await read('../supabase/migrations/20260821194324_add_smart_campaign_hatif_assignee.sql');
  assert.match(sql, /alter table public\.smart_campaigns/i);
  assert.match(sql, /add column if not exists assigned_hatif_user_id uuid/i);
  assert.match(sql, /add column if not exists assigned_hatif_user_name text/i);
  assert.doesNotMatch(sql, /drop\s+(table|column)|delete\s+from|truncate/i);
});

test('draft persistence writes and reads the selected Hatif assignee', async () => {
  const service = await read('../src/lib/smartCampaignService.js');
  assert.match(service, /assignedHatifUserId:\s*row\.assigned_hatif_user_id\s*\|\|\s*null/);
  assert.match(service, /assignedHatifUserName:\s*row\.assigned_hatif_user_name\s*\|\|\s*null/);
  assert.match(service, /assigned_hatif_user_id:\s*payload\.assignedHatifUserId\s*\|\|\s*null/);
  assert.match(service, /assigned_hatif_user_name:\s*payload\.assignedHatifUserName\s*\|\|\s*null/);
});

test('campaign log hooks execute before the loading return', async () => {
  const page = await read('../src/pages/WhatsAppSettings.jsx');
  const componentStart = page.indexOf('function CampaignsTab()');
  const nextComponent = page.indexOf('\nfunction ', componentStart + 1);
  const component = page.slice(componentStart, nextComponent > -1 ? nextComponent : undefined);
  const viewEffect = component.indexOf('const next = allowedViews.includes(requestedView)');
  const loadingReturn = component.indexOf('if (rows == null) return');
  assert.ok(viewEffect > -1, 'view synchronization effect must exist');
  assert.ok(loadingReturn > -1, 'loading return must exist');
  assert.ok(viewEffect < loadingReturn, 'all hooks must run before the conditional loading return');
});

test('opening channel review remains separate from saving a draft', async () => {
  const page = await read('../src/pages/SmartCampaignCenter.jsx');
  assert.match(page, /onClick=\{saveDraft\}[\s\S]{0,200}>حفظ كمسودة<\/Btn>/);
  assert.match(page, /step < 5 \? goToStep\(step \+ 1\) : launch\(\)/);
  assert.match(page, /channel === 'whatsapp'\) setWaCampaign\(saved\)/);
});
