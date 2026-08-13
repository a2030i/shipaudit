import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCustomerDecisions } from '../src/lib/overviewService.js';

test('overview joins camelCase customer money to snake_case merchant snapshot by store id', () => {
  const result = buildCustomerDecisions({
    customers: [{
      name: 'مؤسسة أنا تقني للتجارة - Rever',
      storeId: '102',
      storeName: 'Rever',
      owed: 634,
      inv_cnt: 6,
      b1: 634,
      b2: 0,
      b3: 0,
    }],
  }, {
    snapshot: { uploadedAt: '2026-08-11T00:00:00Z' },
    merchants: [{
      store_id: '102',
      store_name: 'Rever',
      billing_type: 'دفع لاحق',
      status: 'نشط',
      wallet_balance: 0,
    }],
  });

  assert.equal(result.stopPostpaid.length, 1);
  assert.equal(result.stopPostpaid[0].name, 'Rever');
  assert.equal(result.stopPostpaid[0].over30, 634);
  assert.equal(result.unlinkedFinance.length, 0);
});

test('overview does not stop an active postpaid store for debt inside 30 days only', () => {
  const result = buildCustomerDecisions({
    customers: [{ name: 'حديث', storeId: '7', owed: 500, inv_cnt: 1, b0_15: 500, b1: 0, b2: 0, b3: 0 }],
  }, {
    snapshot: { uploadedAt: '2026-08-11T00:00:00Z' },
    merchants: [{ store_id: '7', store_name: 'حديث', billing_type: 'دفع لاحق', status: 'نشط' }],
  });

  assert.equal(result.stopPostpaid.length, 0);
});

test('overview keeps same-name prepaid and postpaid stores separate by store id', () => {
  const result = buildCustomerDecisions({
    customers: [
      { name: 'مشاري سعد - مختلفٌ', storeId: '654', storeName: 'مختلفٌ', owed: 460, inv_cnt: 1, b0_15: 460, b1: 0, b2: 0, b3: 0 },
      { name: 'حبيب سعد - مختلفٌ', storeId: '1961', storeName: 'مختلفٌ', owed: 0, inv_cnt: 0, b1: 0, b2: 0, b3: 0 },
    ],
  }, {
    snapshot: { uploadedAt: '2026-08-13T00:00:00Z' },
    merchants: [
      { store_id: '1961', store_name: 'مختلفٌ', billing_type: 'دفع مسبق', status: 'نشط', wallet_balance: 66 },
      { store_id: '654', store_name: 'مختلفٌ', billing_type: 'دفع لاحق', status: 'نشط', wallet_balance: 0 },
    ],
  });

  assert.deepEqual(result.deductPrepaid.map(row => row.storeId), []);
  assert.deepEqual(result.stopPostpaid.map(row => row.storeId), []);
});
