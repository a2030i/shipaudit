import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20260822015620_sales_core_optimization.sql');
const hub = read('src/pages/SalesHub.jsx');
const pipeline = read('src/pages/PlatformSalesCrm.jsx');
const today = read('src/pages/NextActions.jsx');
const nextActions = read('src/lib/nextActionsService.js');
const whatsapp = read('src/lib/whatsappService.js');
const modal = read('src/components/WhatsAppSendModal.jsx');

test('sales hub mounts only the active reachable view', () => {
  assert.match(hub, /visibleViews\.find\(item => item\.id === view\)/);
  assert.doesNotMatch(hub, /visibleViews\.map\(/);
});

test('pipeline keeps filters and paging in the URL and loads employees lazily', () => {
  assert.match(pipeline, /const \[searchParams, setSearchParams\] = useSearchParams\(\)/);
  assert.match(pipeline, /writeFilters\(\{ page: page \+ 2 \}\)/);
  assert.match(pipeline, /onFocus=\{ensureEmployees\}/);
  assert.doesNotMatch(pipeline, /useEffect\(\(\) => \{[\s\S]{0,250}loadEmployees\(\)/);
  assert.match(pipeline, /متاجر تشترك في رقم التواصل/);
});

test('today queue is server paginated with an explicit legacy rollback path', () => {
  assert.match(nextActions, /VITE_SALES_CORE_READ_ENABLED/);
  assert.match(nextActions, /customer_growth_action_queue_page/);
  assert.match(nextActions, /pageSize = 50/);
  assert.match(today, /loadNextBestActionsPage/);
  assert.doesNotMatch(today, /loadEmployees/);
  assert.doesNotMatch(today, /limit:\s*1000/);
});

test('sales WhatsApp status is scope-limited and fails closed', () => {
  assert.match(migration, /create or replace function public\.sales_whatsapp_campaign_status/);
  assert.match(migration, /phone_outside_sales_scope/);
  assert.match(migration, /campaigns\.send/);
  assert.match(migration, /approximate_name_date_correlation/);
  assert.match(whatsapp, /loadSalesWhatsAppCampaignStatus/);
  assert.match(modal, /salesAudience\s*\?\s*loadSalesWhatsAppCampaignStatus/);
  assert.match(modal, /const safetyReady = protectionsReady && campaignStatusReady && !protectionsError/);
  assert.match(modal, /disabled=\{sending \|\| !safetyReady/);
});

test('new sales read paths are additive, local and read only', () => {
  assert.doesNotMatch(migration, /https?:\/\//i);
  assert.doesNotMatch(migration, /insert\s+into|update\s+public\.|delete\s+from/i);
  assert.match(migration, /private\.customer_growth_action_queue/);
  assert.match(migration, /limit greatest\(1, least\(coalesce\(p_page_size, 50\), 100\)\)/);
});
