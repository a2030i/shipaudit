import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const fingerprint = text => createHash('sha256').update(text.replace(/\r\n?/g, '\n')).digest('hex');
const sha256 = async path => fingerprint(await read(path));

const businessLocks = new Map([
  ['src/lib/retargetingService.js', '20d4d4391349c9f25facb13fcea0380ee66226769fe222585c2bb3ed2fb6de3a'],
  ['src/lib/nextActionsService.js', '50a5167ab8607d3e48c49b95426daf66d4e9e4ff3d69b6dd6e18207872acc4ec'],
  ['src/lib/crmService.js', 'bb9208efa5f70f122674869160cb4fa60cb54641adac34d221a887c452597167'],
  ['src/lib/crmLeadsService.js', '88aa891500f9499974b534a4b2fc823ff72cc7bf2a155b8d376cc5430b79aac5'],
  ['src/lib/smartCampaignService.js', 'bb8e745145a8c7579bdba754bb81d395dde1a2806b42f406349116acc08971b8'],
  ['src/lib/whatsappAudience.js', '828a9524181d18c1f413e150bb013ad6615cfee9330d8f562931be72b0b494ff'],
  ['src/lib/whatsappService.js', 'd42b82f664834790a3393c50b0a236cfa138cf477f5fe577ec1547a642e669eb'],
  ['src/lib/ivrService.js', '004639598cc7883406f0b76317f549cc40a8c485a08e8c89e9335b405fb255b2'],
  ['src/lib/agingOperations.js', '8d389bc89365699c80f236365585d361410d13baaa12cfa0229e4532d4e8f262'],
  ['src/lib/customerCampaignBuckets.js', 'f5c5ba48670bbad2891c357df79c36bd1ed2ddb35684b900edcf297e2268990e'],
  ['src/lib/customerGrowthTaxonomy.js', '482df91caf4cd8ee0dccd892ade4889fe279e498326cb997a0c5f3cdc17be322'],
  ['src/lib/customer360Service.js', '256b68057020145d822393629e51a56386ace223bc61b2f31aff3b20976b804b'],
  ['src/lib/merchantsService.js', 'e1bcdf3ef8b2601c4021441d2d629659760e6f96720ff67f2d9007b4a8c7bc40'],
  ['src/lib/segmentsService.js', '0a650d4833a1e9843d2702cb772e423274cd665add8e6fb26c370246ef37bee1'],
  ['src/lib/hatifLeadsService.js', 'f63b0161e6e66632dedbb45e32ec4821f23f14ccea64059fdafae4ecd26f0fac'],
  ['src/lib/hatifCommitmentsService.js', 'e0eeb051b19a102dc14c14bd9e5cdb795d4ee4d69dc282accd9d6da11d2e46bf'],
  ['src/components/WhatsAppSendModal.jsx', '6fe1a1416e8a7576569c7ed3be88c3e3d9c285c82756219b555ebd25e4673c19'],
  ['src/components/IvrCampaignModal.jsx', '1ddba7850d068369daf4af5236a2ac3c23796264ef19952d13847a93f399c923'],
]);

test('Phase 6 fingerprints canonicalize LF, CRLF and lone CR equally', () => {
  assert.equal(fingerprint('one\ntwo\n'), fingerprint('one\r\ntwo\r\n'));
  assert.equal(fingerprint('one\ntwo\n'), fingerprint('one\rtwo\r'));
});

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
