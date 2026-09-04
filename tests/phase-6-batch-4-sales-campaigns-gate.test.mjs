import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const sha256 = async path => createHash('sha256').update(await read(path)).digest('hex');

const businessLocks = new Map([
  ['src/lib/retargetingService.js', '16064423009a66c71863dda9931928fbbb0661edb430a6855eeb244517e2a26b'],
  ['src/lib/nextActionsService.js', '968375aec5bf05e8df027fb3907ccafe6698d6dabd470fedefeda6c94ef7040b'],
  ['src/lib/crmService.js', 'bb9208efa5f70f122674869160cb4fa60cb54641adac34d221a887c452597167'],
  ['src/lib/crmLeadsService.js', '7002abf56cca8f19328ac9e8c1da27c3e7ec5ba6504cfa46dfbb76c5e07860f9'],
  ['src/lib/smartCampaignService.js', '264f1947a377261159a80834a0ab54762f5ebc09d5902f6dd44440d3426013a7'],
  ['src/lib/whatsappAudience.js', '828a9524181d18c1f413e150bb013ad6615cfee9330d8f562931be72b0b494ff'],
  ['src/lib/whatsappService.js', '0c8d4da27be15c0dfc58939d797a3c3d9946a16483bdcf01d036eaf1a42d8aaf'],
  ['src/lib/ivrService.js', '004639598cc7883406f0b76317f549cc40a8c485a08e8c89e9335b405fb255b2'],
  ['src/lib/agingOperations.js', '291a81eab42e2fb8e9ec0d8237dc9665a21504c252295726c795ea0830b75916'],
  ['src/lib/customerCampaignBuckets.js', 'd80010975959af861ca173d5a5dac458b6fe4d312c2ac8211b5f5627462c9cfa'],
  ['src/lib/customerGrowthTaxonomy.js', '482df91caf4cd8ee0dccd892ade4889fe279e498326cb997a0c5f3cdc17be322'],
  ['src/lib/customer360Service.js', '013a0af9053c48b6104a8cd58b257b8aa9f7b32ba8ccfe84376c58254bf44ac3'],
  ['src/lib/merchantsService.js', '4e6366bd222903786bf8dfdad6c60c618086a566de5edba3a24545b9e697be6a'],
  ['src/lib/segmentsService.js', '0a650d4833a1e9843d2702cb772e423274cd665add8e6fb26c370246ef37bee1'],
  ['src/lib/hatifLeadsService.js', 'f63b0161e6e66632dedbb45e32ec4821f23f14ccea64059fdafae4ecd26f0fac'],
  ['src/lib/hatifCommitmentsService.js', 'e0eeb051b19a102dc14c14bd9e5cdb795d4ee4d69dc282accd9d6da11d2e46bf'],
  ['src/components/WhatsAppSendModal.jsx', '2e0b74a94017aa5afeb5da993e1874f3eb3b780506b9a2a3a4b983ed6e7fc40b'],
  ['src/components/IvrCampaignModal.jsx', 'ee9fd568b8215ca74358714a4abd598b52f98b5bff675c56ea87504321823b82'],
]);

test('Batch 4 keeps sales, audience, assignment and channel behavior byte-identical', async () => {
  for (const [path, expected] of businessLocks) assert.equal(await sha256(path), expected, `${path} business lock changed`);
});

test('sales exposes one six-area workspace and one Customer 360 identity', async () => {
  const [hub, nav] = await Promise.all([
    read('src/pages/SalesHub.jsx'),
    read('src/components/enterprise/SalesWorkspaceNav.jsx'),
  ]);
  for (const label of ['نظرة عامة', 'مسار المبيعات', 'العملاء والفرص', 'المتابعة', 'مهام الاستعادة', 'الشرائح والعروض']) assert.match(nav, new RegExp(label));
  assert.match(hub, /SalesWorkspaceNav/);
  assert.match(hub, /Customer 360/);
  assert.doesNotMatch(hub, /import Merchants/);
  assert.match(hub, /external[\s\S]*hatif/);
});

test('campaign workspace separates audience, setup, launch, active and results', async () => {
  const [page, nav] = await Promise.all([
    read('src/pages/SmartCampaignCenter.jsx'),
    read('src/components/enterprise/CampaignWorkspaceNav.jsx'),
  ]);
  for (const label of ['الجمهور', 'الإعداد والمسودات', 'المراجعة والإطلاق', 'الحملات النشطة', 'النتائج والسجل']) assert.match(nav, new RegExp(label));
  for (const label of ['إجمالي المطابق', 'غير مؤهل / مستبعد', 'مؤهل', 'يحتاج مراجعة']) assert.match(page, new RegExp(label));
  assert.match(page, /caption="السجلات المكوّنة لعدد الجمهور"/);
  assert.match(page, /setWaCampaign\(campaignPayload\('ready'\)\)/);
  assert.match(page, /setIvrCampaign\(campaignPayload\('ready'\)\)/);
  assert.match(page, /onBeforeExecute=\{prepareChannelExecution\}/);
});

test('migrated sales and campaign tables use the central DataTable', async () => {
  const pages = [
    'src/pages/PlatformSalesCrm.jsx', 'src/pages/NextActions.jsx', 'src/pages/StoreActivation.jsx',
    'src/pages/Retargeting.jsx', 'src/pages/HatifLeads.jsx', 'src/pages/Segments.jsx',
    'src/pages/CrmWorkspace.jsx', 'src/pages/SmartCampaignCenter.jsx', 'src/pages/WhatsAppSettings.jsx',
  ];
  for (const path of pages) {
    const source = await read(path);
    assert.match(source, /design-system\/EnterpriseUI\.jsx/, `${path} must use EnterpriseUI`);
    assert.doesNotMatch(source, /<table(?:\s|>)/, `${path} must not own a raw table`);
  }
});

test('legacy sales and campaign routes preserve query context into canonical workspaces', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /\['\/retargeting', '\/hatif-leads', '\/segments', '\/next-actions'\]\.includes\(rawPath\)/);
  assert.match(app, /new URLSearchParams\(params\)[\s\S]*next\.set\('view', legacyView\)[\s\S]*navigate\(`\/workspace\/sales\?\$\{next\.toString\(\)\}`/);
  assert.match(app, /rawPath === '\/campaigns'[\s\S]*new URLSearchParams\(params\)[\s\S]*navigate\(`\/workspace\/campaigns\?\$\{next\.toString\(\)\}`/);
  assert.match(app, /rawPath === '\/merchants'[\s\S]*navigate\(`\/customer-360\?\$\{next\.toString\(\)\}`/);
});
