import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Carrier 360 exposes one carrier-scoped home with the seven approved views', async () => {
  const page = await read('src/pages/CarrierProfile.jsx');
  for (const label of [
    'نظرة عامة',
    'الفواتير والمراجعة',
    'الشحنات',
    'المطالبات',
    'الحساب والمدفوعات',
    'العقد والأسعار',
    'الأداء',
  ]) assert.match(page, new RegExp(label));
  assert.match(page, /رفع فاتورة للمراجعة/);
  assert.match(page, /initialCarrierId=\{carrier\.id\}/);
  assert.match(page, /lockCarrier/);
});

test('invoice analysis and results remain inside the active carrier profile', async () => {
  const app = await read('src/App.jsx');
  const results = await read('src/pages/AuditResults.jsx');
  assert.match(app, /view=invoices&mode=result&invoice=/);
  assert.match(results, /نتيجة مراجعة فاتورة/);
  for (const label of ['كل الشحنات', 'فروقات الوزن', 'فروقات الأسعار', 'الرسوم الإضافية', 'COD', 'الاستبعادات']) {
    assert.match(results, new RegExp(label));
  }
});

test('carrier-scoped legacy routes resolve to Carrier 360 sections', async () => {
  const app = await read('src/App.jsx');
  for (const path of ['/upload', '/audits', '/claims', '/ledger', '/cod-settlements', '/aramex-statements', '/payments', '/carrier-kpi', '/contracts']) {
    assert.match(app, new RegExp(`'${path.replace('/', '\\/')}'`));
  }
  assert.match(app, /navigate\(`\/carrier\?\$\{next\.toString\(\)\}`/);
});

test('mobile Carrier 360 uses a compact view selector and card layouts', async () => {
  const css = await read('src/pages/carrier-360.css');
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /\.carrier360-view-nav select/);
  assert.match(css, /\.carrier360-invoice-list > button/);
  assert.match(css, /\.carrier360-shipment-list article/);
  assert.match(css, /\.carrier360-shipment-list \{ grid-template-columns: 1fr; \}/);
});

test('invoice upload can be locked to the carrier opened by the user', async () => {
  const wizard = await read('src/pages/UploadWizard.jsx');
  assert.match(wizard, /initialCarrierId = ''/);
  assert.match(wizard, /lockCarrier = false/);
  assert.match(wizard, /لا يطابق شركة الشحن المفتوحة/);
  assert.match(wizard, /تم تثبيت الشركة من ملفها المفتوح/);
});

test('carrier review uses one presentation contract and paginates every stored shipment', async () => {
  const page = await read('src/pages/CarrierProfile.jsx');
  const results = await read('src/pages/AuditResults.jsx');
  const presentation = await read('src/lib/auditPresentation.js');
  assert.match(page, /auditPresentation\(audit\)/);
  assert.match(page, /countAuditShipments\(invoiceId\)/);
  assert.match(presentation, /audit\?\.diff \?\? summary\.totalDiff/);
  assert.match(presentation, /legacy_unverified/);
  assert.match(results, /SHIPMENT_PAGE_SIZE = 100/);
  assert.match(results, /countAuditShipments\(audit\.id/);
  assert.match(results, /شحنة قابلة للمراجعة/);
  assert.doesNotMatch(results, /limit: 5000/);
});

test('carrier list exposes direct upload, open and review actions without a parallel flow', async () => {
  const hub = await read('src/pages/CarriersHub.jsx');
  assert.match(hub, /\+ رفع فاتورة شركة شحن/);
  assert.match(hub, />\s*رفع فاتورة\s*</);
  assert.match(hub, />\s*فتح الشركة\s*</);
  assert.match(hub, /فاتورة تحتاج مراجعة لدى/);
  assert.match(hub, /view=invoices&mode=upload/);
  assert.match(hub, /action=upload-invoice/);
});
