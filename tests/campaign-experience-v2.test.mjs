import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('smart campaign preview is read-only and channel modals receive only eligible recipients', async () => {
  const page = await read('../src/pages/SmartCampaignCenter.jsx');
  assert.match(page, /setWaCampaign\(campaignPayload\('ready'\)\)/);
  assert.match(page, /setIvrCampaign\(campaignPayload\('ready'\)\)/);
  assert.match(page, /recipients=\{waCampaign \? audienceSummary\.ready : \[\]\}/);
  assert.match(page, /audienceSummary\.ready\.map\(row => \(\{ phone: row\.to/);
  assert.match(page, /onBeforeExecute=\{prepareChannelExecution\}/);
});

test('campaign results open in the same workspace with WhatsApp and IVR live details', async () => {
  const [page, modal] = await Promise.all([
    read('../src/pages/SmartCampaignCenter.jsx'),
    read('../src/components/CampaignResultModal.jsx'),
  ]);
  assert.match(page, /<CampaignResultModal/);
  assert.match(page, /onOpenResult=\{setResultCampaign\}/);
  assert.match(modal, /loadCampaignStats\(name\)/);
  assert.match(modal, /loadIvrCalls\(\{ campaign: name/);
  assert.match(modal, /المستلم أوقف الرسائل التسويقية/);
  assert.match(modal, /running: 'تعمل الآن'/);
});

test('campaign status is visible at collection decision time without blocking the main queue', async () => {
  const page = await read('../src/pages/Collections.jsx');
  assert.match(page, /const campaignStatusesPromise = loadWhatsAppCampaignStatus\(\)/);
  assert.doesNotMatch(page, /Promise\.all\(\[[\s\S]{0,1800}loadWhatsAppCampaignStatus/);
  assert.match(page, /'آخر حملة'/);
  assert.match(page, /waStatusBadge\(campaignStatus\)/);
  assert.match(page, /لا توجد حملة سابقة/);
});

test('Customer 360 surfaces the latest communication and campaign before drill-down', async () => {
  const page = await read('../src/pages/Store360Page.jsx');
  assert.match(page, /s360-communication-summary/);
  assert.match(page, /<b>آخر تواصل<\/b>/);
  assert.match(page, /<b>آخر حملة<\/b>/);
  assert.match(page, /communicationTitle\(latestCommunication\)/);
  assert.match(page, /تولّى الفريق المحادثة/);
});

test('Hatif employee failure is elevated before campaign composition', async () => {
  const page = await read('../src/pages/SmartCampaignCenter.jsx');
  assert.match(page, /scc-integration-alert/);
  assert.match(page, /إطلاق WhatsApp متوقف حتى يكتمل ربط موظفي هاتف/);
  assert.match(page, /مراجعة الربط/);
});
