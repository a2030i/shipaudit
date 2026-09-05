import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, access } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 7 removes only dependency-proven dead files', async () => {
  const removed = [
    'src/pages/Marketers.jsx',
    'src/pages/Marketers.css',
    'src/pages/OperationsCenter.css',
    'src/pages/legal-escalation.css',
    'src/components/operations/FigmaCustomerPortfolio.jsx',
    'src/components/operations/figma-customer-portfolio.css',
    'src/components/CenterWorkspace.jsx',
  ];
  for (const path of removed) {
    await assert.rejects(access(new URL(`../${path}`, import.meta.url)), `${path} should be absent`);
  }
});

test('active advanced tables use the central DataTable wrapper', async () => {
  for (const path of [
    'src/components/IvrSettingsTab.jsx',
    'src/components/LamhaStorePerformance.jsx',
    'src/components/WhatsAppCampaignLog.jsx',
    'src/pages/UploadsHub.jsx',
    'src/pages/WebhookEvents.jsx',
  ]) {
    const source = await read(path);
    assert.match(source, /DataTable/);
    assert.doesNotMatch(source, /<table(?:\s|>)/, `${path} still owns a raw table`);
  }
});

test('legacy StatCard and DropZone exports are retired after replacement', async () => {
  const legacy = await read('src/components/UI.jsx');
  const enterprise = await read('src/design-system/EnterpriseUI.jsx');
  assert.doesNotMatch(legacy, /export function (?:StatCard|DropZone)/);
  assert.match(enterprise, /export function StatStrip/);
  assert.match(enterprise, /export function DropZone/);
});

test('finance compatibility wrapper is removed without removing deep-link routes', async () => {
  const app = await read('src/App.jsx');
  assert.doesNotMatch(app, /import CenterWorkspace/);
  assert.match(app, /const renderWorkspaceView = \(tabs, activePath\)/);
  for (const path of ['/bank', '/cod-settlements', '/payments', '/reconciliation', '/cash-aging', '/forecast', '/periods']) {
    assert.ok(app.includes(`'${path}'`), `${path} compatibility route missing`);
  }
});
