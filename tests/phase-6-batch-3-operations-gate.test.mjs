import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const migratedPages = [
  'src/pages/CarriersHub.jsx',
  'src/pages/CarrierProfile.jsx',
  'src/pages/Tasks.jsx',
  'src/pages/AccountingCycle.jsx',
  'src/pages/SmartDrop.jsx',
  'src/pages/UploadWizard.jsx',
  'src/pages/AuditResults.jsx',
  'src/pages/CarrierStatements.jsx',
  'src/pages/CarrierLedger.jsx',
  'src/pages/FulfillmentAudit.jsx',
  'src/pages/WeightBilling.jsx',
  'src/pages/Claims.jsx',
  'src/pages/EnterpriseAuditsHistory.jsx',
];

test('Batch 3 exposes one operations workspace language without CenterWorkspace cards', async () => {
  const [app, nav, overview] = await Promise.all([
    read('src/App.jsx'),
    read('src/components/enterprise/OperationsWorkspaceNav.jsx'),
    read('src/components/enterprise/EnterpriseOperationsOverview.jsx'),
  ]);
  for (const label of ['نظرة عامة', 'شركات الشحن', 'الاستثناءات', 'دورة المحاسب', 'الفواتير والملفات', 'فوترة الخدمات', 'COD والتسويات']) {
    assert.match(nav, new RegExp(label));
  }
  assert.match(app, /section\.id === 'shipping'[\s\S]*EnterpriseOperationsOverview/);
  assert.doesNotMatch(app, /scope="operations-(?:carriers|audit|service-billing)"/);
  assert.match(overview, /DataTable/);
  assert.match(overview, /كل مؤشر يفتح السجلات التي كوّنته/);
});

test('migrated operational pages consume the central design system and no raw table implementation', async () => {
  for (const path of migratedPages) {
    const source = await read(path);
    assert.match(source, /design-system\/EnterpriseUI\.jsx/, `${path} must use EnterpriseUI`);
    assert.doesNotMatch(source, /<table(?:\s|>)/, `${path} must not own a raw table`);
  }
  for (const path of migratedPages.filter(path => !path.endsWith('Claims.jsx'))) {
    const source = await read(path);
    assert.match(source, /OperationsWorkspaceNav/, `${path} must expose the shared operations navigation`);
  }
});

test('Carrier 360 remains the entity detail and compact audit rows cannot grant action eligibility', async () => {
  const page = await read('src/pages/CarrierProfile.jsx');
  for (const view of ['overview', 'invoices', 'shipments', 'claims', 'account', 'contract', 'performance']) {
    assert.match(page, new RegExp(`\\['${view}',`));
  }
  assert.match(page, /function auditListPresentation/);
  assert.match(page, /reviewStatus: 'legacy_unverified'/);
  assert.match(page, /The full invoice read still uses auditPresentation/);
  assert.match(page, /const result = auditPresentation\(audit\)/);
});

test('accountant cycle preserves the established state vocabulary and invoice-only carrier model', async () => {
  const [page, model] = await Promise.all([
    read('src/pages/AccountingCycle.jsx'),
    read('src/lib/carrierOperatingModel.js'),
  ]);
  for (const status of ['complete', 'ready', 'attention', 'pending', 'blocked']) {
    assert.match(page, new RegExp(`${status}: \\{ label:`));
  }
  assert.match(page, /not_required: \{ label: 'غير مطلوب'/);
  assert.match(page, /<Tabs[\s\S]*label="مرحلة دورة المحاسب"/);
  assert.match(page, /<UploadWizard[\s\S]*lockPeriod embedded/);
  assert.match(page, /<AuditResults[\s\S]*embedded/);
  assert.match(model, /return \['invoice'\]/);
  assert.match(model, /status: 'not_required'/);
  assert.match(model, /requiresManualUpload: false/);
});

test('legacy operational redirects preserve incoming query context and identifiers', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /lazy\(\(\) => import\('\.\/pages\/EnterpriseAuditsHistory\.jsx'\)\)/);
  assert.match(app, /const next = new URLSearchParams\(params\)[\s\S]*next\.delete\('carrier'\)[\s\S]*next\.set\('id', scopedCarrier\)/);
  assert.match(app, /next\.set\('view', view\)/);
  assert.match(app, /if \(auditId\) next\.set\('invoice', auditId\)/);
  assert.match(app, /rawPath === '\/upload'[\s\S]*next\.set\('action', 'upload-invoice'\)/);
  assert.match(app, /const next = new URLSearchParams\(location\.search\)[\s\S]*next\.set\('mode', 'result'\)/);
  assert.match(app, /loadAuditByIdFromDB\(auditId\)[\s\S]*new URLSearchParams\(location\.search\)[\s\S]*next\.set\('invoice', a\.id\)/);
});

test('imports and file drop surfaces keep their existing parsers and accepted formats', async () => {
  const [drop, wizard, fulfillment] = await Promise.all([
    read('src/pages/SmartDrop.jsx'),
    read('src/pages/UploadWizard.jsx'),
    read('src/pages/FulfillmentAudit.jsx'),
  ]);
  assert.match(drop, /detectHeaderRow, buildHeaders, detectColumns, detectCarrierFromFile/);
  assert.match(drop, /accept="\.xlsx,\.xls,\.pdf"/);
  assert.match(wizard, /auditAll, buildSummary/);
  assert.match(wizard, /parseAramexInvoice/);
  assert.match(fulfillment, /DropZone/);
});
