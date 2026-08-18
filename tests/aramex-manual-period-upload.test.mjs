import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { findUnmappedMonetaryColumns, isExactMonetaryMirror } from '../src/engine/audit.js';
import { applyApprovedAramexTerms, SEED_CARRIERS } from '../src/data/carriers.js';
import { manualPeriodFallback, missingAuditFields } from '../src/lib/auditUploadPolicy.js';

const aramex = SEED_CARRIERS.find(carrier => carrier.id === 'aramex');
const schema = { required: ['awb', 'shipDate', 'weight', 'deliveryCharges'] };
const colMap = { awb: 'Airway Bill No.', weight: 'Chargeable Weight', deliveryCharges: 'Base Charge' };

test('Aramex missing shipment dates require an explicit monthly-period confirmation', () => {
  assert.deepEqual(missingAuditFields(schema, colMap, { carrier: aramex, manualPeriodConfirmed: false }), ['shipDate']);
  assert.deepEqual(missingAuditFields(schema, colMap, { carrier: aramex, manualPeriodConfirmed: true }), []);
  assert.deepEqual(manualPeriodFallback({ carrier: aramex, colMap, confirmed: true }), {
    eligible: true,
    active: true,
    precision: 'month',
    shipmentDateAvailable: false,
  });
});

test('the monthly fallback stays Aramex-only and does not weaken other carrier requirements', () => {
  const smsa = { id: 'smsa', name: 'SMSA' };
  assert.deepEqual(missingAuditFields(schema, colMap, { carrier: smsa, manualPeriodConfirmed: true }), ['shipDate']);
});

test('Aramex Amount is accepted only when it exactly mirrors Base Charge', () => {
  const headers = ['Airway Bill No.', 'Base Charge', 'Amount'];
  const rows = [
    { 'Airway Bill No.': '5081', 'Base Charge': 13, Amount: 13 },
    { 'Airway Bill No.': '5082', 'Base Charge': 44, Amount: 44 },
  ];
  assert.equal(isExactMonetaryMirror(rows, 'Amount', 'Base Charge'), true);
  assert.deepEqual(findUnmappedMonetaryColumns(headers, rows, colMap, { exactMirrorTargets: ['Base Charge'] }), []);
  rows[1].Amount = 45;
  assert.equal(isExactMonetaryMirror(rows, 'Amount', 'Base Charge'), false);
  assert.deepEqual(findUnmappedMonetaryColumns(headers, rows, colMap, { exactMirrorTargets: ['Base Charge'] }).map(row => row.header), ['Amount']);
});

test('approved Aramex defaults are fuel 10 percent and COD 3 SAR', () => {
  const contract = aramex.contracts[0];
  assert.equal(contract.fuelPct, 0.10);
  assert.equal(contract.codFee, 3);
});

test('stored Aramex contracts active in July receive the approved terms', () => {
  const stored = [
    { id: 'c_1', name: 'ارامكس', contracts: [{ id: 'active', startDate: '2026-03-01', fuelPct: 0.16, codFee: 5 }] },
    { id: 'c_2', name: 'ناقل آخر', contracts: [{ id: 'other', startDate: '2026-01-01', fuelPct: 0.16, codFee: 5 }] },
    { id: 'c_3', name: 'Aramex legacy', contracts: [{ id: 'expired', startDate: '2025-01-01', endDate: '2026-06-30', fuelPct: 0.16, codFee: 5 }] },
  ];
  const normalized = applyApprovedAramexTerms(stored);
  assert.equal(normalized[0].contracts[0].fuelPct, 0.10);
  assert.equal(normalized[0].contracts[0].codFee, 3);
  assert.equal(normalized[1].contracts[0].codFee, 5);
  assert.equal(normalized[2].contracts[0].codFee, 5);
});

test('UploadWizard records month precision without manufacturing shipment dates', async () => {
  const source = await readFile(new URL('../src/pages/UploadWizard.jsx', import.meta.url), 'utf8');
  assert.match(source, /periodPrecision:\s*periodFallback\.active \? 'month'/);
  assert.match(source, /shipmentDateAvailability:\s*periodFallback\.active \? 'unavailable_in_source'/);
  assert.doesNotMatch(source, /shipDate\s*:\s*`?\$?\{?inferred\.year/);
});
