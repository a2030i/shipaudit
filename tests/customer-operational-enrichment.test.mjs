import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichOperationalRows, loadOperationalAgeAmounts } from '../src/lib/customerReceivablesRead.js';

test('enrichment replaces the displayed amount with the exact age-scoped amount', () => {
  const rows = [{
    identityKey: 'store:10',
    customer: { storeId: 10, zohoId: 'z10', owed: 900, invCnt: 4 },
    summary: { amount: 900, invoiceCount: 4, oldestDays: 120 },
    reason: 'لديه مبلغ مستحق قابل للتحصيل',
  }];
  const enriched = enrichOperationalRows(rows, {
    ageAmounts: new Map([['z10', {
      amount: 125.25, invoiceCount: 2, openingCount: 0,
      oldestDays: 45, oldestDueDate: '2026-07-15',
    }]]),
    sharedContexts: new Map([['10', {
      sharedStoreCount: 2,
      sharedStores: [{ storeId: '11', storeName: 'متجر آخر' }],
    }]]),
  });
  assert.equal(enriched[0].summary.amount, 125.25);
  assert.equal(enriched[0].customer.owed, 900);
  assert.equal(enriched[0].customer.sharedContactStoreCount, 2);
  assert.equal(enriched[0].customer.sharedContactStores[0].storeId, '11');
});

test('an opening-only customer cannot fall back to the full balance inside an invoice-age scope', () => {
  const rows = [{
    customer: { storeId: 10, zohoId: 'z10', owed: 900, invCnt: 0 },
    summary: { amount: 900, invoiceCount: 0, openingCount: 1, oldestDays: 231 },
  }];
  const [enriched] = enrichOperationalRows(rows, { ageAmounts: new Map() });
  assert.equal(enriched.operationalAgeScopeMatched, false);
  assert.equal(enriched.summary.amount, 0);
  assert.equal(enriched.summary.openingCount, 0);
  assert.equal(enriched.summary.oldestDays, 0);
});

test('age aggregate loader sends the requested age and bucket contract', async () => {
  let call;
  const client = {
    rpc: async (name, args) => {
      call = { name, args };
      return { data: [{ zoho_id: 'z1', amount: 80, invoice_count: 1, oldest_days: 45 }], error: null };
    },
  };
  const result = await loadOperationalAgeAmounts({
    aging: new Set(['inv31_60']), minDays: '30', maxDays: '60',
  }, client);
  assert.equal(call.name, 'customer_operational_age_amounts');
  assert.deepEqual(call.args, {
    p_aging: ['inv31_60'], p_min_days: 30, p_max_days: 60,
  });
  assert.equal(result.get('z1').amount, 80);
});
