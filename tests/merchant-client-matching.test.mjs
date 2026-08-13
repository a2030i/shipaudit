import assert from 'node:assert/strict';
import test from 'node:test';

import { findMerchantForCustomer } from '../src/lib/merchantsService.js';

test('name-only matching rejects two stores with the same display name', () => {
  const result = findMerchantForCustomer('مشاري سعد - مختلفٌ', [
    { store_id: 1961, store_name: 'مختلفٌ', billing_type: 'دفع مسبق' },
    { store_id: 654, store_name: 'مختلفٌ', billing_type: 'دفع لاحق' },
  ]);
  assert.equal(result, null);
});

test('name-only matching still returns a unique exact store', () => {
  const result = findMerchantForCustomer('مؤسسة مثال - متجر فريد', [
    { store_id: 42, store_name: 'متجر فريد', billing_type: 'دفع لاحق' },
    { store_id: 43, store_name: 'اسم آخر', billing_type: 'دفع مسبق' },
  ]);
  assert.equal(result?.storeId, 42);
  assert.equal(result?.method, 'auto-exact');
});
