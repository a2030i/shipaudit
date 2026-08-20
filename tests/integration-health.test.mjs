import test from 'node:test';
import assert from 'node:assert/strict';
import { assessHatifHealth, assessZohoHealth } from '../src/lib/integrationHealth.js';

const NOW = Date.parse('2026-08-20T12:00:00.000Z');

test('Zoho requires a fresh sync and a verified webhook', () => {
  const healthy = assessZohoHealth({
    lastSyncAt: '2026-08-20T11:30:00.000Z', webhookReady: true,
  }, NOW);
  assert.equal(healthy.status, 'healthy');

  const unverified = assessZohoHealth({
    lastSyncAt: '2026-08-20T11:30:00.000Z', webhookReady: false,
  }, NOW);
  assert.equal(unverified.status, 'attention');
  assert.match(unverified.reasons.join(' '), /الاستقبال الفوري/);
});

test('Hatif reports attention when message failure is above ten percent', () => {
  const health = assessHatifHealth({
    delivery: { total: 100, pending: 5, failed: 38 },
    callSync: { synced_at: '2026-08-20T11:00:00.000Z' },
    zoho: { lastSyncAt: '2026-08-20T11:30:00.000Z', webhookReady: true },
  }, NOW);
  assert.equal(health.status, 'attention');
  assert.equal(health.coverage, 95);
  assert.equal(health.failureRate, 38);
  assert.match(health.reasons.join(' '), /فشل الرسائل/);
});

test('Hatif and Operations can share one healthy contract', () => {
  const health = assessHatifHealth({
    delivery: { total: 100, pending: 2, failed: 3 },
    callSync: { synced_at: '2026-08-20T11:00:00.000Z' },
    zoho: { lastSyncAt: '2026-08-20T11:30:00.000Z', webhookReady: true },
  }, NOW);
  assert.equal(health.status, 'healthy');
  assert.equal(health.healthy, true);
  assert.deepEqual(health.reasons, []);
});

test('Missing integration evidence is unavailable rather than healthy', () => {
  const health = assessHatifHealth({}, NOW);
  assert.equal(health.status, 'unavailable');
  assert.equal(health.healthy, false);
});
