import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { shippingLifecycle } from '../src/lib/customerGrowthTaxonomy.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const day = 86_400_000;
const now = Date.UTC(2026, 7, 30, 12);

test('shipping lifecycle separates sales activation from retention at the five-day boundary', () => {
  assert.deepEqual(
    shippingLifecycle({ shipmentCount: 0, lastShipmentAt: null, now }).key,
    'never_shipped',
  );
  assert.equal(shippingLifecycle({ shipmentCount: 2, lastShipmentAt: new Date(now - 5 * day).toISOString(), now }).key, 'active');
  const stopped = shippingLifecycle({ shipmentCount: 2, lastShipmentAt: new Date(now - 6 * day).toISOString(), now });
  assert.equal(stopped.key, 'stopped');
  assert.equal(stopped.owner, 'فريق الحفاظ على العملاء');
  assert.equal(stopped.daysSinceLast, 6);
});

test('the executive command center exposes the growth target and direct operational queues', async () => {
  const [overview, command] = await Promise.all([
    read('src/pages/Overview.jsx'),
    read('src/components/operations/FigmaCommandCenter.jsx'),
  ]);
  assert.match(overview, /loadCustomerActivationCommandCenter/);
  assert.match(overview, /loadLamhaStorePerformance\(\{ filter: 'never_shipped'/);
  assert.match(overview, /customerGrowth=\{customerGrowth\}/);
  for (const label of ['نمو العملاء النشطين', 'الفجوة إلى المستهدف', 'متاجر لم تشحن إطلاقًا', 'اشتغلوا ثم توقفوا', 'عادوا للشحن']) {
    assert.match(command, new RegExp(label));
  }
  assert.match(command, /performanceFilter=never_shipped/);
  assert.match(command, /customerGrowth\.neverShippedCount/);
  assert.match(command, /bucket=stopped&work=all/);
  assert.match(command, /work=unassigned/);
});

test('account status and shipping activity use distinct manager-facing labels', async () => {
  const customers = await read('src/pages/CustomerWatch.jsx');
  assert.match(customers, /حساب لمحة قابل للشحن/);
  assert.match(customers, /حساب موقوف في لمحة/);
  assert.doesNotMatch(customers, /label="نشط حالياً"/);
});

test('Store 360 turns missing first shipment and stopped shipping into explicit decisions', async () => {
  const page = await read('src/pages/Store360Page.jsx');
  assert.match(page, /تسجيل إفادة الحفاظ على العميل/);
  assert.match(page, /تسجيل نتيجة تفعيل أول شحنة/);
  assert.match(page, /CUSTOMER_OUTCOME_GROUPS/);
  assert.match(page, /سُجّل العميل ولم ينفّذ أول شحنة/);
  assert.match(page, /توقف العميل عن الشحن منذ/);
  assert.match(page, /اختر نتيجة التواصل أو سبب التوقف/);
});

test('the customer pipeline identifies queue ownership and keeps causes analyzable', async () => {
  const [page, taxonomy] = await Promise.all([
    read('src/pages/PlatformSalesCrm.jsx'),
    read('src/lib/customerGrowthTaxonomy.js'),
  ]);
  assert.match(page, /فريق الحفاظ على العملاء/);
  assert.match(page, /فريق المبيعات/);
  assert.match(page, /تبدأ المتابعة من اليوم السادس/);
  assert.match(page, /نتيجة التواصل \/ سبب التوقف/);
  for (const cause of ['لا توجد طلبات', 'نشاط موسمي', 'مشكلة شركة شحن', 'مشكلة تقنية أو ربط', 'عائق مالي أو تحصيل']) {
    assert.match(taxonomy, new RegExp(cause));
  }
});

test('never-shipped result set can be assigned as one exact filtered sales queue', async () => {
  const [component, service] = await Promise.all([
    read('src/components/LamhaStorePerformance.jsx'),
    read('src/lib/retargetingService.js'),
  ]);
  assert.match(component, /\['never_shipped', 'dormant_30'\]\.includes\(filter\)/);
  assert.match(component, /loadAllLamhaStorePerformanceRows\(\{ filter, search: appliedSearch \}\)/);
  assert.match(component, /assignPlatformSalesAccounts\(assignmentPhones, ownerId\)/);
  assert.match(component, /لن يغيّر حالة الحساب أو النشاط أو أي مبلغ/);
  assert.match(service, /while \(rows\.length < count && rows\.length < maxRows\)/);
});
