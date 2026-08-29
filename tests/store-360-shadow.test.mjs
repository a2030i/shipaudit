import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const shadowPath = new URL('../src/lib/store360Shadow.js', import.meta.url);

test('shadow adapter is staging gated, exact-store keyed and failure isolated', async () => {
  const source = await fs.readFile(shadowPath, 'utf8');
  assert.match(source, /VITE_STORE_360_CORE_SHADOW_READ === '1'/);
  assert.match(source, /client\.rpc\('store_360_core', \{ p_store_id: String\(storeId\) \}\)/);
  assert.match(source, /status: 'error'/);
  assert.doesNotMatch(source, /sink\?\.\(\{[^}]*oldCore/);
  assert.doesNotMatch(source, /sink\?\.\(\{[^}]*nextCore/);
});

test('production adapter preserves the established Store 360 shape', async () => {
  const { adaptStore360Core } = await import(shadowPath);
  const result = adaptStore360Core({
    storeId: '847', sections: {
      identity: { visibility: 'visible', status: 'available', data: {
        storeId: '847', storeName: 'Store', phone: '0500000000', shipmentCount: 3,
        sharedContactStores: [],
      }, source: { availabilityStatus: 'available', freshnessStatus: 'fresh', dataAsOf: '2026-08-21T00:00:00Z' } },
      financialLink: { visibility: 'visible', status: 'resolved', data: { status: 'resolved', customerName: 'Customer' } },
      finance: { visibility: 'visible', status: 'available', data: {
        collectibleDue: 100, overdue: 80, oldestAgeDays: 45, openInvoiceCount: 2,
        aging: { invoice1To15: 10, invoice16To30: 20, invoice31To60: 30, invoice61To90: 40, invoiceOver90: 0, openingBalance: 0 },
      }, source: { availabilityStatus: 'available', freshnessStatus: 'fresh' } },
      lastPayment: { visibility: 'visible', status: 'available', data: { date: '2026-08-20', amount: 25 }, source: { availabilityStatus: 'available' } },
      collections: { visibility: 'visible', status: 'empty', data: null, source: { availabilityStatus: 'available' } },
      sales: { visibility: 'restricted', status: 'restricted', data: null, source: null },
    },
  });
  assert.equal(result.store.storeId, '847');
  assert.equal(result.customerName, 'Customer');
  assert.equal(result.financial.outstanding, 100);
  assert.equal(result.financial.aging.b31_60, 30);
  assert.equal(result.financial.lastPaymentAmount, 25);
  assert.equal(result.sources.identity.freshnessStatus, 'fresh');
  assert.equal(result.prefetchedWork.sources.sales.status, 'restricted');
  assert.equal(result.readPath, 'store_360_core');
});

test('core mode is exact-store only and retains immediate legacy fallback', async () => {
  const source = await fs.readFile(new URL('../src/lib/store360Service.js', import.meta.url), 'utf8');
  const adapter = await fs.readFile(shadowPath, 'utf8');
  assert.match(adapter, /VITE_STORE_360_CORE_READ_MODE \|\| 'core'/);
  assert.match(source, /STORE_360_CORE_READ_MODE === 'core'/);
  assert.match(source, /\/\^\\d\+\$\//);
  assert.match(source, /catch \{\s*return loadStore360CoreLegacy\(identity, \{ shadow: false \}\)/);
});

test('visible Store 360 path schedules shadow only after old result is complete', async () => {
  const source = await fs.readFile(new URL('../src/lib/store360Service.js', import.meta.url), 'utf8');
  const built = source.indexOf('const core = {');
  const shadow = source.lastIndexOf('scheduleStore360CoreShadow');
  const attached = source.indexOf('return attachFinancialContext(core);', built);
  assert.ok(built > -1 && shadow > built && attached > shadow);
  assert.match(source, /fire-and-forget/);
});

test('shadow RPC failure is contained and reported without throwing', async () => {
  const { runStore360CoreShadow } = await import(shadowPath);
  const observed = [];
  const result = await runStore360CoreShadow({
    storeId: '847', oldCore: { store: { storeId: '847' } },
    client: { rpc: async () => ({ data: null, error: { code: 'BRANCH_DOWN' } }) },
    sink: event => observed.push(event),
  });
  assert.equal(result.status, 'error');
  assert.equal(result.errorCode, 'BRANCH_DOWN');
  assert.deepEqual(observed, [result]);
});
