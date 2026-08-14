import assert from 'node:assert/strict';
import test from 'node:test';

import {
  consolidateMerchantSnapshotRows,
  filterMerchantsByShipmentMonth,
  merchantLastShipmentMonth,
  parseStoresFile,
} from '../src/lib/merchantsService.js';

test('store snapshot parser collapses duplicate store ids before database insert', () => {
  const parsed = parseStoresFile([
    ['رقم المتجر', 'اسم المتجر', 'عدد الشحنات', 'تاريخ اخر شحنة', 'حالة المتجر'],
    [102, 'Rever قديم', 5, '2026-06-01', 'غير نشط'],
    ['102.0', 'Rever', 8, '2026-08-01', 'نشط'],
    [103, 'متجر آخر', 1, '2026-07-01', 'نشط'],
  ]);

  assert.equal(parsed.sourceRowCount, 3);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.duplicateRowCount, 1);
  assert.deepEqual(parsed.duplicateStoreIds, ['102']);
  assert.equal(parsed.rows.find(row => row.storeId === '102').storeName, 'Rever');
  assert.equal(parsed.rows.find(row => row.storeId === '102').shipmentCount, 8);
});

test('duplicate consolidation fills optional blanks from the other occurrence', () => {
  const result = consolidateMerchantSnapshotRows([
    { storeId: '7', storeName: 'متجر', phone: '966500000000', shipmentCount: 1, lastShipmentAt: '2026-07-01' },
    { storeId: '7', storeName: 'متجر', phone: null, shipmentCount: 2, lastShipmentAt: '2026-08-01' },
  ]);

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].shipmentCount, 2);
  assert.equal(result.rows[0].phone, '966500000000');
  assert.equal(result.duplicateRowCount, 1);
});

test('last shipment month filter uses the platform calendar month without timezone drift', () => {
  const merchants = [
    { store_id: '101', last_shipment_at: '2026-07-31T00:00:00.000Z' },
    { store_id: '102', last_shipment_at: '2026-07-01' },
    { store_id: '103', last_shipment_at: '2026-08-01T00:00:00.000Z' },
    { store_id: '104', last_shipment_at: null },
  ];

  assert.equal(merchantLastShipmentMonth(merchants[0].last_shipment_at), '2026-07');
  assert.deepEqual(
    filterMerchantsByShipmentMonth(merchants, '2026-07').map(row => row.store_id),
    ['101', '102'],
  );
  assert.equal(filterMerchantsByShipmentMonth(merchants, '').length, 4);
});

test('July merchant route can be shared as a direct filter URL', () => {
  const params = new URLSearchParams('lastShipmentMonth=2026-07');
  assert.equal(params.get('lastShipmentMonth'), '2026-07');
});
