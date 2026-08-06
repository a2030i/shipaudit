import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

import {
  isVerifiedAuditForWeightBilling,
  toLamhaShipmentSearchRows,
  toLamhaWeightRows,
} from '../src/lib/weightBillingService.js';

const verifiedControl = {
  version: 3,
  valid: true,
  fileName: 'carrier-july.xlsx',
  contractLabels: ['عقد يوليو 2026'],
};

test('ملف أوزان لمحة لا يقبل مراجعة تاريخية بلا إثبات عقدي', () => {
  assert.equal(isVerifiedAuditForWeightBilling({ review_status: 'approved', col_map: {} }), false);
  assert.equal(isVerifiedAuditForWeightBilling({
    review_status: 'approved',
    col_map: { __control: { ...verifiedControl, contractLabels: [] } },
  }), false);
  assert.equal(isVerifiedAuditForWeightBilling({
    review_status: 'approved',
    col_map: { __control: verifiedControl },
  }), true);
});

test('قائمة البحث الجماعي في لمحة تحتوي أرقام الشحنات فقط وتمنع التكرار', () => {
  const rows = toLamhaShipmentSearchRows([
    { awb: ' JTE001 ' },
    { awb: 'JTE002', weight: 15 },
    { awb: 'JTE001', carrier: 'J&T' },
    { awb: '' },
  ]);
  assert.deepEqual(rows, [
    { 'رقم الشحنة': 'JTE001' },
    { 'رقم الشحنة': 'JTE002' },
  ]);
  assert.deepEqual(Object.keys(rows[0]), ['رقم الشحنة']);
});

test('تصدير الوزن يستخدم أعمدة لمحة فقط وبالمسميات الدقيقة', () => {
  const rows = toLamhaWeightRows([{ awb: ' JTE001 ', weight: 30.126, carrier: 'J&T', period: '2026-07' }]);
  assert.deepEqual(rows, [{ 'رقم الشحنة': 'JTE001', 'الوزن الجديد': 30.13 }]);
  assert.deepEqual(Object.keys(rows[0]), ['رقم الشحنة', 'الوزن الجديد']);

  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'أوزان للفوترة');
  const serialized = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const reopened = XLSX.read(serialized, { type: 'buffer' });
  const roundTrip = XLSX.utils.sheet_to_json(reopened.Sheets['أوزان للفوترة'], { defval: null });
  assert.deepEqual(roundTrip, [{ 'رقم الشحنة': 'JTE001', 'الوزن الجديد': 30.13 }]);
});
