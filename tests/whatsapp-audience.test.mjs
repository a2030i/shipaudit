import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareWhatsAppAudienceRows, summarizeWhatsAppAudience, whatsappRecipientKey } from '../src/lib/whatsappAudience.js';

test('campaign audience reconciles every filtered row to ready or one exclusion reason', () => {
  const rows = prepareWhatsAppAudienceRows([
    { to: '966500000001', storeId: 1 },
    { to: '966500000001', storeId: 2 },
    { to: '', storeId: 3 },
    { to: '966500000004', storeId: 4 },
    { to: '966500000005', storeId: 5 },
    { to: '966500000006', storeId: 6 },
  ]);
  const summary = summarizeWhatsAppAudience({
    rows,
    noWhatsapp: new Set(['966500000004']),
    weakPhones: new Set(['966500000005']),
  });

  assert.equal(summary.source, 6);
  assert.equal(summary.ready.length, 2);
  assert.deepEqual(summary.counts, {
    missingPhone: 1,
    duplicatePhone: 1,
    noWhatsapp: 1,
    previousCampaign: 0,
    hatifTouched: 0,
    weakNumber: 1,
    debtor: 0,
  });
  assert.equal(summary.excluded, 4);
  assert.equal(summary.source, summary.ready.length + summary.excluded);
});

test('empty store ids never collapse different recipients to the same selection key', () => {
  assert.equal(whatsappRecipientKey({ to: '966500000001', storeId: '' }, 0), '966500000001#0');
  assert.equal(whatsappRecipientKey({ to: '966500000002', storeId: null }, 1), '966500000002#1');
});

test('per-store mode keeps stores sharing one phone independently eligible', () => {
  const rows = prepareWhatsAppAudienceRows([
    { to: '966500000001', storeId: 10 },
    { to: '966500000001', storeId: 11 },
  ]);
  const merged = summarizeWhatsAppAudience({ rows });
  const perStore = summarizeWhatsAppAudience({ rows, perStore: true });

  assert.equal(merged.ready.length, 1);
  assert.equal(merged.counts.duplicatePhone, 1);
  assert.equal(perStore.ready.length, 2);
  assert.equal(perStore.counts.duplicatePhone, 0);
});

test('reported 44-result audience can reconcile explicitly to 26 ready and 18 excluded', () => {
  const recipients = Array.from({ length: 44 }, (_, index) => ({
    to: `9665${String(index).padStart(8, '0')}`,
    storeId: index + 1,
  }));
  const rows = prepareWhatsAppAudienceRows(recipients);
  const summary = summarizeWhatsAppAudience({
    rows,
    noWhatsapp: new Set(recipients.slice(0, 3).map(row => row.to)),
    hatifTouched: new Map(recipients.slice(3, 8).map(row => [row.to, '2026-08-05'])),
    weakPhones: new Set(recipients.slice(8, 18).map(row => row.to)),
  });

  assert.equal(summary.source, 44);
  assert.equal(summary.ready.length, 26);
  assert.equal(summary.excluded, 18);
  assert.equal(summary.source, summary.ready.length + summary.excluded);
});
