import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveSavedWorkspaceRoute, resolveWorkspace } from '../src/lib/navigation.js';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const navigationItems = [
  {
    id: 'hub',
    path: '/hub',
    section: 'shipping',
    subTabs: [{ tabId: 'kpi', legacy: '/carrier-kpi' }],
  },
  { id: 'reports', path: '/reports', section: 'reports' },
];

test('RLA-01: a saved route is restored only inside its canonical workspace', () => {
  assert.equal(resolveSavedWorkspaceRoute({
    requestedWorkspace: 'shipping',
    fallbackPath: '/workspace/operations',
    savedRoute: '/carrier-kpi?source=cross-parity&page=2',
    navigationItems,
  }), '/carrier-kpi?source=cross-parity&page=2');

  assert.equal(resolveSavedWorkspaceRoute({
    requestedWorkspace: 'shipping',
    fallbackPath: '/workspace/operations',
    savedRoute: '/reports?range=month',
    navigationItems,
  }), '/workspace/operations');
});

test('RLA-01: query parameters never change workspace ownership', () => {
  assert.equal(resolveWorkspace('/carrier-kpi', navigationItems), 'shipping');
  assert.equal(resolveWorkspace('/carrier-kpi?source=cross-parity', navigationItems), 'shipping');
  assert.equal(resolveWorkspace('/carrier-kpi?source=reports&returnTo=%2Fworkspace%2Freports', navigationItems), 'shipping');
});

test('RLA-01: the shell and saved-route validation share one ownership resolver', async () => {
  const app = await source('src/App.jsx');
  assert.match(app, /resolveSavedWorkspaceRoute\(\{[\s\S]*requestedWorkspace: center\.id[\s\S]*navigationItems: NAV_ITEMS/);
  assert.match(app, /const routeWorkspaceId = resolveWorkspace\(rawPath, NAV_ITEMS\)/);
  assert.match(app, /routeWorkspaceId \? NAV_SECTIONS\.find\(section => section\.id === routeWorkspaceId\)/);
  assert.doesNotMatch(app, /rawPath === '\/carrier-kpi'[\s\S]{0,120}forcedSectionId/);
});

test('RLA-01: carrier KPI keeps its direct deep link and operational content contract', async () => {
  const app = await source('src/App.jsx');
  assert.match(app, /const CARRIER_WORKSPACE_PATHS = \['\/hub', '\/carrier-kpi', '\/claims'\]/);
  assert.match(app, /const OPERATIONS_CARRIER_PATHS = \['\/hub', '\/carrier-kpi'/);
  assert.match(app, /'\/carrier-kpi': \['performance', \{\}\]/);
  assert.match(app, /KNOWN_PATHS = \[[^\]]*'\/carrier-kpi'/);
});
