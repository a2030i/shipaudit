import test from 'node:test';
import assert from 'node:assert/strict';

import {
  auditRow,
  auditAll,
  buildSummary,
  detectColumns,
  findUnmappedMonetaryColumns,
  mapRows,
} from '../src/engine/audit.js';
import { evaluateApprovalGate } from '../src/lib/coreService.js';
import { extractWorkbookControl, parseWorkbookNumber } from '../src/engine/workbookControl.js';

const headers = [
  'Tracking No.', 'Entry time', 'Origin', 'Destination', 'Settlement weight',
  'Delivery Charge', 'COD amount', 'COD payment method', 'COD service charge',
  'Total Charge', 'VAT Amount', 'Receivable Amount', 'Signing status',
];

const baseRow = {
  'Tracking No.': 'JTE000977406658',
  'Entry time': '2026-06-28 16:13:25',
  Origin: 'Madinah Province-Madinah',
  Destination: 'Makkah Province-Jeddah',
  'Settlement weight': 1,
  'Delivery Charge': 16,
  'COD amount': 0,
  'COD payment method': '',
  'COD service charge': 0,
  'Total Charge': 16,
  'VAT Amount': 2.4,
  'Receivable Amount': 18.4,
  'Signing status': 'Normal Sign',
};

const contract = {
  id: 'jnt-2026',
  label: 'J&T 2026',
  startDate: '2026-01-01',
  pricing: {
    'Saudi Arabia': [
      { upTo: 15, price: 16 },
      { upTo: null, pricePerUnit: 1, unitKg: 1 },
    ],
  },
  posFeePct: 0.02,
};

const carrier = { id: 'jnt', name: 'J&T Express', contracts: [contract] };
const colMap = detectColumns(headers, carrier, [carrier]);
const verifiedControl = { version: 3, valid: true, errors: [] };

function approval(summary, results = []) {
  return evaluateApprovalGate({
    summary: { ...summary, control: verifiedControl },
    control: verifiedControl,
    results,
  });
}

function run(rows, selectedDate = '2026-06-01', carrierOverride = carrier) {
  const mapped = mapRows(rows, colMap);
  const results = auditAll(mapped, carrierOverride, selectedDate);
  return { mapped, results, summary: buildSummary(results) };
}

test('J&T control totals map and a contract-perfect row passes', () => {
  assert.equal(colMap.statedTotal, 'Total Charge');
  assert.equal(colMap.grossTotal, 'Receivable Amount');
  const { results, summary } = run([baseRow]);
  assert.equal(results[0].contractId, contract.id);
  assert.equal(results[0].status, 'ok');
  assert.equal(summary.totalBilled, 16);
  assert.equal(summary.totalExpected, 16);
  assert.equal(summary.totalGross, 18.4);
});

test('an unrecognised additional fee is exposed by Total Charge and blocks approval', () => {
  const row = { ...baseRow, 'Total Charge': 21, 'VAT Amount': 3.15, 'Receivable Amount': 24.15 };
  const { results, summary } = run([row]);
  assert.equal(results[0].status, 'mismatch');
  assert.equal(results[0].invoiced.otherCharges, 5);
  assert.ok(results[0].issues.some(issue => issue.field === 'otherCharges'));
  assert.equal(approval(summary, results).canApprove, false);
});

test('a shipment outside every contract date cannot be approved', () => {
  const expired = { ...contract, endDate: '2026-05-31' };
  const { results, summary } = run([baseRow], '2026-06-01', { ...carrier, contracts: [expired] });
  assert.equal(results[0].status, 'no_contract');
  const gate = approval(summary, results);
  assert.equal(summary.unknown, 1);
  assert.equal(gate.canApprove, false);
  assert.ok(gate.errors.some(error => error.code === 'unresolved_rows'));
});

test('overlapping matching contracts are treated as an ambiguity, not silently selected', () => {
  const second = { ...contract, id: 'jnt-overlap', label: 'Overlapping J&T contract' };
  const { results, summary } = run([baseRow], '2026-06-01', { ...carrier, contracts: [contract, second] });
  assert.equal(results[0].status, 'contract_ambiguous');
  assert.equal(summary.unknown, 1);
  assert.equal(approval(summary, results).canApprove, false);
});

test('approval recomputes pre-tax drift instead of trusting a stale stored zero', () => {
  const gate = evaluateApprovalGate({
    control: verifiedControl,
    driftPreTax: 0,
    summary: { total: 1, mismatch: 0, unknown: 0, totalBilled: 20, totalExpected: 16, totalTax: 3, control: verifiedControl },
  });
  assert.equal(gate.canApprove, false);
  assert.ok(gate.errors.some(error => error.code === 'drift_pre_tax'));
});

test('detail-vs-summary control failure blocks approval', () => {
  const gate = evaluateApprovalGate({
    summary: {
      total: 1, mismatch: 0, unknown: 0, totalBilled: 16, totalExpected: 16, totalTax: 2.4,
      control: { version: 3, valid: false, errors: ['الإجمالي قبل الضريبة لا يطابق الملخص'] },
    },
  });
  assert.equal(gate.canApprove, false);
  assert.ok(gate.errors.some(error => error.code === 'statement_control_failed'));
});

test('a clean-looking legacy audit without v3 contract proof cannot be approved', () => {
  const gate = evaluateApprovalGate({
    summary: { total: 1, mismatch: 0, unknown: 0, totalBilled: 16, totalExpected: 16, totalTax: 2.4 },
  });
  assert.equal(gate.canApprove, false);
  assert.ok(gate.errors.some(error => error.code === 'missing_audit_proof'));
});

test('non-zero hidden monetary columns are blocked while zero-only templates are ignored', () => {
  const extendedHeaders = [...headers, 'Chargeable weight', 'Additional fee', 'Packaging material fee'];
  const rows = [
    { ...baseRow, 'Chargeable weight': 1, 'Additional fee': 0, 'Packaging material fee': 0 },
    { ...baseRow, 'Tracking No.': 'JTE000977406659', 'Chargeable weight': 2, 'Additional fee': 5, 'Packaging material fee': 0 },
  ];
  const extendedMap = detectColumns(extendedHeaders, carrier, [carrier]);
  const hidden = findUnmappedMonetaryColumns(extendedHeaders, rows, extendedMap);
  assert.deepEqual(hidden.map(item => item.header), ['Additional fee']);
  assert.equal(hidden[0].totalAbs, 5);
});

test('inbound rows without an explicit contract rate are unverifiable and block approval', () => {
  const inboundContract = { ...contract, inboundPassthrough: true };
  const inboundCarrier = { ...carrier, contracts: [inboundContract] };
  const row = {
    ...baseRow,
    Origin: 'United Arab Emirates',
    Destination: 'Saudi Arabia',
  };
  const { results, summary } = run([row], '2026-06-01', inboundCarrier);
  assert.equal(results[0].status, 'unverifiable');
  assert.equal(summary.unknown, 1);
  assert.equal(approval(summary, results).canApprove, false);
});

test('a passthrough COD fee is not accepted as contract truth', () => {
  const passthroughContract = { ...contract, codFeePassthrough: true, codFee: undefined };
  const passthroughCarrier = { ...carrier, contracts: [passthroughContract] };
  const row = {
    ...baseRow,
    'COD amount': 100,
    'COD service charge': 3,
    'Total Charge': 19,
    'VAT Amount': 2.85,
    'Receivable Amount': 21.85,
  };
  const { results, summary } = run([row], '2026-06-01', passthroughCarrier);
  assert.equal(results[0].status, 'unverifiable');
  assert.ok(results[0].issues.some(issue => issue.field === 'contract'));
  assert.equal(approval(summary, results).canApprove, false);
});

test('overlapping date ranges are safe when their destination price books are disjoint', () => {
  const domestic = { ...contract, id: 'domestic', label: 'محلي' };
  const gcc = {
    ...contract,
    id: 'gcc',
    label: 'خليجي',
    pricing: { 'United Arab Emirates': [{ upTo: 15, price: 40 }] },
  };
  const { results } = run([baseRow], '2026-06-01', { ...carrier, contracts: [domestic, gcc] });
  assert.equal(results[0].status, 'ok');
  assert.equal(results[0].contractId, 'domestic');
});

test('workbook control reads a dedicated J&T summary sheet', () => {
  const declared = extractWorkbookControl([
    {
      name: 'Order details',
      rows: [headers, Object.values(baseRow)],
      isSummary: false,
    },
    {
      name: 'SUMMARY',
      isSummary: true,
      rows: [
        ['Billing Time Range', 'Total Shipments', 'Sum of Total Charge', 'Sum of VAT Amount', 'Sum of Receivable Amount'],
        ['2026-06-01 ~ 2026-06-30', 2118, 27750.6654, 4162.5998, 31913.2652],
      ],
    },
  ], 'Order details');

  assert.deepEqual(declared, {
    sheetName: 'SUMMARY',
    range: '2026-06-01 ~ 2026-06-30',
    shipmentCount: 2118,
    totalBilled: 27750.6654,
    totalTax: 4162.5998,
    totalGross: 31913.2652,
  });
});

test('workbook control reads a DeliverNow footer below detail rows', () => {
  const declared = extractWorkbookControl([
    {
      name: 'Invoice',
      isSummary: false,
      rows: [
        ['AWB', 'Delivery Charges', 'Total', 'Grand Total'],
        ['DN-1', 11, 11, 12.65],
        [],
        ['Total Invoice before VAT', 'SR -1,199.00'],
        ['VAT Amount', 'SR -179.85'],
        ['Total Invoice after VAT', 'SR -1,378.85'],
      ],
    },
  ], 'Invoice');

  assert.deepEqual(declared, {
    sheetName: 'Invoice',
    range: '',
    shipmentCount: null,
    totalBilled: 1199,
    totalTax: 179.85,
    totalGross: 1378.85,
  });
});

test('workbook amount parsing accepts accounting signs and rejects labels', () => {
  assert.equal(parseWorkbookNumber('SAR (1,378.85)'), -1378.85);
  assert.equal(parseWorkbookNumber('SR \u2212179.85'), -179.85);
  assert.equal(parseWorkbookNumber('Total Invoice after VAT'), null);
});

test('DeliverNow maps row totals as independent invoice controls', () => {
  const deliverNow = {
    id: 'delivernow',
    name: 'DeliverNow',
    contracts: [{
      id: 'dn-2026',
      label: 'DeliverNow 2026',
      startDate: '2026-01-01',
      pricing: { 'Saudi Arabia': [{ upTo: 15, price: 11 }] },
    }],
  };
  const deliverHeaders = ['AWB', 'Close Date', 'Weight', 'Delivery Charges', 'COD Amount', 'COD Fee', 'Total', 'VAT Amount', 'Grand Total'];
  const deliverMap = detectColumns(deliverHeaders, deliverNow, [deliverNow]);
  assert.equal(deliverMap.statedTotal, 'Total');
  assert.equal(deliverMap.grossTotal, 'Grand Total');
  const mapped = mapRows([{
    AWB: 'DNE000000001', 'Close Date': '2026-06-28', Weight: 1,
    'Delivery Charges': 11, 'COD Amount': 0, 'COD Fee': 0,
    Total: 11, 'VAT Amount': 1.65, 'Grand Total': 12.65,
  }], deliverMap);
  const results = auditAll(mapped, deliverNow, '2026-06-01');
  assert.equal(results[0].status, 'ok');
  assert.equal(results[0].invoiced.total, 11);
  assert.equal(results[0].grossTotal, 12.65);
});

const pricedRow = overrides => ({
  awb: 'TST000000001',
  shipDate: '2026-06-28',
  origin: 'Saudi Arabia',
  dest: 'Saudi Arabia',
  domestic: true,
  isCod: false,
  weight: 1,
  deliveryCharges: 0,
  rss: 0,
  fuelSurcharge: 0,
  codFee: 0,
  codAmount: 0,
  posAmount: 0,
  posFee: 0,
  tax: 0,
  taxRate: 0,
  excessFee: 0,
  statedTotal: null,
  grossTotal: null,
  ...overrides,
});

test('iMile verifies delivery, COD and POS fees from contract formulas', () => {
  const result = auditRow(pricedRow({
    deliveryCharges: 10,
    codAmount: 100,
    codFee: 1,
    posAmount: 100,
    posFee: 1,
    statedTotal: 12,
    tax: 1.8,
    grossTotal: 13.8,
  }), {
    pricing: { 'Saudi Arabia': [{ upTo: 15, price: 10 }] },
    codFee: 1,
    posFeePct: 0.01,
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.expected.codFee, 1);
  assert.equal(result.expected.posFee, 1);
  assert.equal(result.expected.total, 12);
});

test('Aymakan and SMSA fuel percentages are computed from contract prices', () => {
  const aymakan = auditRow(pricedRow({
    deliveryCharges: 13,
    fuelSurcharge: 0.975,
    statedTotal: 13.975,
  }), {
    pricing: { 'Saudi Arabia': [{ upTo: 15, price: 13 }] },
    fuelPct: 0.075,
  });
  assert.equal(aymakan.status, 'ok');
  assert.equal(aymakan.expected.fuel, 0.975);

  const smsa = auditRow(pricedRow({
    deliveryCharges: 12,
    fuelSurcharge: 1.2,
    statedTotal: 13.2,
    taxRate: 15,
    grossTotal: 15.18,
  }), {
    pricing: { 'Saudi Arabia': [{ upTo: 15, price: 12 }] },
    fuelPct: 0.10,
  });
  assert.equal(smsa.status, 'ok');
  assert.equal(smsa.expected.fuel, 1.2);
  assert.equal(smsa.invoiced.tax, 1.98);
});

test('Boleeseh selects the COD price book of the actual sub-carrier', () => {
  const boleeseh = {
    id: 'boleeseh',
    name: 'Boleeseh',
    contracts: [{
      id: 'bol-2026',
      label: 'Boleeseh 2026',
      startDate: '2026-01-01',
      pricingKey: 'subCarrier',
      pricing: {
        jt_express: [{ upTo: 15, price: 16 }],
        jt_express_cod: [{ upTo: 15, price: 18.4 }],
      },
    }],
  };
  const [result] = auditAll([pricedRow({
    deliveryCharges: 18.4,
    statedTotal: 18.4,
    subCarrier: 'jt_express',
    codPaymentMethod: 'cod',
  })], boleeseh, '2026-06-01');
  assert.equal(result.status, 'ok');
  assert.equal(result.dest, 'jt_express_cod');
  assert.equal(result.expected.delivery, 18.4);
});

test('Delex operational rows require reconciliation to a carrier invoice summary', () => {
  const delex = {
    id: 'delex',
    name: 'Delex',
    contracts: [{
      id: 'delex-2026',
      label: 'Delex 2026',
      startDate: '2026-01-01',
      pricing: { 'Saudi Arabia': [{ upTo: 15, price: 10 }] },
      posFeePct: 0.02,
      priceFromContract: true,
    }],
  };
  const [result] = auditAll([pricedRow({ codAmount: 100 })], delex, '2026-06-01');
  assert.equal(result.status, 'ok');
  assert.equal(result.verificationMode, 'contract_summary');
  assert.equal(result.expected.total, 12);
});

test('Webek verifies its inclusive delivery and POS formula without inventing a COD fee', () => {
  const webekContract = {
    pricing: { 'Saudi Arabia': [{ upTo: null, price: 14 }] },
    posFeePct: 0.008,
    posFeeOnCod: true,
    codFeePassthrough: true,
    deliveryInclusiveVat: true,
    excessPerKg: 2,
  };
  const clean = auditRow(pricedRow({
    weight: 0,
    deliveryCharges: 16.1,
    codAmount: 100,
    posFee: 0.8,
  }), webekContract);
  assert.equal(clean.status, 'ok');
  assert.equal(clean.expected.delivery, 14);
  assert.equal(clean.expected.posFee, 0.8);

  const unknownCodFee = auditRow(pricedRow({
    weight: 0,
    deliveryCharges: 16.1,
    codAmount: 100,
    codFee: 3,
    posFee: 0.8,
  }), webekContract);
  assert.equal(unknownCodFee.status, 'unverifiable');

  const unknownExcess = auditRow(pricedRow({
    weight: 0,
    deliveryCharges: 16.1,
    excessFee: 2.3,
  }), webekContract);
  assert.equal(unknownExcess.status, 'unverifiable');
});

test('offsetting component differences cannot masquerade as a contract match', () => {
  const result = auditRow(pricedRow({
    deliveryCharges: 11,
    fuelSurcharge: 0,
    statedTotal: 11,
  }), {
    pricing: { 'Saudi Arabia': [{ upTo: 15, price: 10 }] },
    fuelPct: 0.10,
  });
  assert.equal(result.diffs.total, 0);
  assert.equal(result.diffs.delivery, 1);
  assert.equal(result.diffs.fuel, -1);
  assert.equal(result.status, 'mismatch');
});
