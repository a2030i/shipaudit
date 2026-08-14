import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('integrations center keeps every operational gateway directly reachable', () => {
  const center = read('src/pages/OperationsCenter.jsx');
  const app = read('src/App.jsx');
  const settings = read('src/pages/Settings.jsx');

  assert.match(center, /\/zoho-data\?tab=overview/);
  assert.match(center, /\/zoho-data\?tab=banks/);
  assert.match(center, /stage=lamha_sources/);
  assert.match(center, /stage=lamha_shipments/);
  assert.match(center, /\/whatsapp-settings\?tab=ivr/);
  assert.match(center, /\/settings\/hatif/);
  assert.match(center, /probeTahseelConnection/);
  assert.match(center, /\/settings\/data#tahseel-integration/);
  assert.match(settings, /id="tahseel-integration"/);
  assert.match(app, /id: 'operations'[\s\S]*?label: 'التكاملات'/);
  assert.match(app, /id: 'operations'[\s\S]*?system\.view_settings[\s\S]*?campaigns\.ivr/);
});
