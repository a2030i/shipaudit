import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  defaultAudienceDefinition,
  filterSmartAudience,
} from '../src/lib/smartCampaignService.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('default collection campaign targets over 60 days without opening balances', () => {
  assert.deepEqual(defaultAudienceDefinition('collection').buckets, ['inv61_90', 'inv90p']);
});

test('collection audience amount is calculated only from selected aging buckets', () => {
  const universe = {
    rows: [{
      key: 'store:4',
      name: 'متجر 4',
      platformStatus: 'نشط',
      invoiceCount: 4,
      amounts: { inv1_15: 10, inv16_30: 20, inv31_60: 30, inv61_90: 40, inv90p: 50, opening: 900 },
      fields: {},
    }],
  };

  const rows = filterSmartAudience(universe, 'collection', defaultAudienceDefinition('collection'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 90);
  assert.equal(rows[0].fields.aging_filter, 'inv61_90,inv90p');
});

test('general campaigns accept manual rows without using collections or Zoho', () => {
  const definition = defaultAudienceDefinition('general');
  definition.manualRows = [
    { name: 'عميل أول', phone: '0501234567' },
    { name: 'مكرر', phone: '+966501234567' },
    { name: 'عميل ثان', phone: '0557654321', amount: 120 },
    { name: 'غير صالح', phone: '123' },
  ];

  const rows = filterSmartAudience({ rows: [] }, 'general', definition);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'عميل أول');
  assert.equal(rows[1].amount, 120);
  assert.ok(rows.every(row => row.source === 'manual_campaign'));
});

test('campaign center is action-only and retired from visible Sales workspaces', async () => {
  const app = await read('src/App.jsx');
  const navigation = await read('src/lib/navigation.js');
  const titles = await read('src/lib/pageTitles.js');

  assert.doesNotMatch(app, /id:\s*'campaign-center'[\s\S]*path:\s*'\/campaigns'/);
  assert.match(app, /PATH_PERM\.set\('\/campaigns'/);
  assert.match(app, /campaignActionActive[\s\S]*audienceContext/);
  assert.match(app, /rawPath === '\/campaigns'[\s\S]*!params\.get\('audienceContext'\)[\s\S]*\/whatsapp-settings\?tab=campaigns/);
  assert.match(app, /<SmartCampaignCenter isActive=\{campaignActionActive\}/);
  assert.match(navigation, /'campaign-center':[\s\S]*visible:\s*false/);
  assert.match(titles, /'\/campaigns':\s*'مركز الحملات الذكي'/);
  assert.doesNotMatch(navigation, /id:\s*'campaigns'\s*,\s*label:\s*'الحملات'/);
});

test('all outbound channels keep their existing review gates', async () => {
  const center = await read('src/pages/SmartCampaignCenter.jsx');
  const whatsappModal = await read('src/components/WhatsAppSendModal.jsx');
  const ivrModal = await read('src/components/IvrCampaignModal.jsx');

  assert.match(center, /<WhatsAppSendModal/);
  assert.match(center, /<IvrCampaignModal/);
  assert.match(center, /prepareWhatsAppAudienceRows/);
  assert.match(center, /summarizeWhatsAppAudience/);
  assert.match(center, /الموظف المسؤول في هاتف/);
  assert.match(center, /رفع Excel/);
  assert.doesNotMatch(center, /sendWhatsAppCampaign/);
  assert.match(whatsappModal, /lockedCampaignName/);
  assert.match(ivrModal, /lockedCampaignName/);
  assert.match(whatsappModal, /scheduledAt:\s*new Date\(schedAt\)\.toISOString\(\)/);
  assert.match(ivrModal, /scheduledAt:\s*new Date\(schedAt\)\.toISOString\(\)/);
});

test('campaign builder is first and step navigation scrolls to channel and Hatif owner controls', async () => {
  const center = await read('src/pages/SmartCampaignCenter.jsx');
  const css = await read('src/pages/smart-campaign-center.css');
  assert.ok(center.indexOf('<aside className="scc-composer">') < center.indexOf('<SummaryStrip campaigns={campaignRows}/>'));
  assert.ok(center.indexOf('<aside className="scc-composer">') < center.indexOf('<section className="scc-campaign-list">'));
  assert.match(center, /const goToStep = nextStep/);
  assert.match(center, /4: '\.scc-channels'/);
  assert.match(center, /scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/);
  assert.match(center, /<StepRail step=\{step\} onStep=\{goToStep\}/);
  assert.match(center, /goToStep\(step \+ 1\)/);
  assert.match(css, /\.scc-composer\{overflow:visible\}/);
  assert.match(css, /\.scc-channels[^\{]*\{scroll-margin-block:110px\}/);
});

test('smart campaign schema is RLS protected and anonymous access is revoked', async () => {
  const migration = await read('supabase/migrations/20260815214845_smart_campaign_center.sql');

  for (const table of ['smart_campaigns', 'smart_campaign_events', 'smart_campaign_tasks']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon`));
  }
  assert.match(migration, /security invoker/);
  assert.match(migration, /app_has_any_permission/);
  assert.doesNotMatch(migration, /security definer/i);
});
