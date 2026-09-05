import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const fingerprint = text => createHash('sha256').update(text.replace(/\r\n?/g, '\n')).digest('hex');
const sha256 = async path => fingerprint(await read(path));

const FROZEN_REPORT_SOURCES = {
  'src/lib/monthlyReportService.js': '2191551b82a1ed9d0370a659a7eb760e9f60bc05df28610126aa6f07c9489ac7',
  'src/lib/zohoReportsService.js': '7fbe6db2ed723b73a9382de7d878dd2e1ce07146935258b49d40c0dfd2e1a35b',
  'src/lib/internalExportsService.js': 'b642375018d017556a5f5c34544709a245ef37cc7e2218d254a989f9a5ba757e',
  'src/lib/bankReconReport.js': 'f17432535c85c37665506f651c7cd2b9e9a99c32bc05bcf27c1feb4513249a04',
  'src/lib/carrierSoaExport.js': '559e08190c72d22c756ecab6bf3a97bc0ffd8df120df6c2568a194c451903396',
  'src/lib/soaExport.js': 'c57b3df4f4c31933a2a39dfbd9518a46728bbbeedf4103f33490e522f46cde4f',
  'src/lib/cashAgingService.js': '862da446718c29ab12b7f3feb85bbb650e02d495d28806e009a691a611c94d2c',
  'src/lib/forecastService.js': '81f82cd238bdbe02d694bec7c0993d68057af358653fe6c8d45f7d3244479f6f',
  'src/lib/carrierStatementsService.js': '1cc8f08b97a3ee13f68e10623aa79a764b28886f205dc203f78cdd4c542062c6',
  'src/lib/carrierScore.js': '489ee42dffc6b2d026e7dcb2dd9e2795f0b5a30d2c893a40671d099f9a6376c2',
  'src/lib/platformCarriersService.js': '6730489f191672f54d7bd46d93e177e725e4457f8e788a9b90556a53d2cc9837',
  'src/lib/retargetingService.js': '20d4d4391349c9f25facb13fcea0380ee66226769fe222585c2bb3ed2fb6de3a',
  'src/lib/customerGrowthTaxonomy.js': '482df91caf4cd8ee0dccd892ade4889fe279e498326cb997a0c5f3cdc17be322',
  'src/lib/smartCampaignService.js': 'bb8e745145a8c7579bdba754bb81d395dde1a2806b42f406349116acc08971b8',
  'src/lib/whatsappAudience.js': '828a9524181d18c1f413e150bb013ad6615cfee9330d8f562931be72b0b494ff',
  'src/lib/pnlService.js': '107aef5c823a55951bc836dd629a96ebaf7e73fa17ebf267deb5a7887cdeb37e',
  'src/lib/weightBillingService.js': '54485a8fab8b480583407292a990361d1d5a9fbf81347b3bf17f4120abb4ddb8',
  'src/lib/xlsxRtl.js': '609078fe950f4d4ce6fd70dd1ba0bbd0907e81504984a588aa0ab7d1fce17839',
};

test('Batch 5 freezes every report read model, exporter and classification source', async () => {
  for (const [path, expected] of Object.entries(FROZEN_REPORT_SOURCES)) {
    assert.equal(await sha256(path), expected, `${path} changed during presentation-only migration`);
  }
});

test('every mapped report metric has a complete, unique presentation contract', async () => {
  const { REPORT_METRIC_CONTRACTS } = await import('../src/lib/reportMetricContracts.js');
  assert.equal(REPORT_METRIC_CONTRACTS.length, 54);
  assert.equal(new Set(REPORT_METRIC_CONTRACTS.map(contract => contract.id)).size, REPORT_METRIC_CONTRACTS.length);
  const fields = ['id', 'name', 'definition', 'source', 'period', 'filters', 'aggregation', 'nullBehavior', 'valueType', 'legacyScreen'];
  for (const contract of REPORT_METRIC_CONTRACTS) {
    for (const field of fields) assert.ok(String(contract[field] ?? '').trim(), `${contract.id}.${field} is missing`);
  }
});

test('reports use one canonical workspace and legacy aliases preserve incoming query parameters', async () => {
  const [app, navigation, workspace] = await Promise.all([
    read('src/App.jsx'), read('src/lib/navigation.js'), read('src/pages/ReportsWorkspace.jsx'),
  ]);
  assert.match(app, /\['\/reports', '\/monthly-report', '\/internal-exports'\]\.includes\(rawPath\)/);
  assert.match(app, /const next = new URLSearchParams\(params\);[\s\S]*?navigate\(`\/workspace\/reports\?\$\{next\.toString\(\)\}`/);
  assert.match(navigation, /id: 'reports-workspace'[\s\S]*?path: '\/workspace\/reports'/);
  assert.match(workspace, /returnTo/);
  assert.match(workspace, /target\.searchParams\.set\('returnTo'/);
});

test('Batch 5 tabular reports all use the central DataTable primitive', async () => {
  const paths = [
    'src/pages/ReportsCenter.jsx', 'src/pages/MonthlyReport.jsx',
    'src/pages/InternalExports.jsx', 'src/pages/PlatformCarriers.jsx',
  ];
  for (const path of paths) {
    const source = await read(path);
    assert.match(source, /DataTable/);
    assert.doesNotMatch(source, /<table\b/);
  }
});

test('monthly display and export retain the existing formulas and exact export schema', async () => {
  const monthly = await read('src/pages/MonthlyReport.jsx');
  assert.match(monthly, /\(\(r\.billed - prev\) \/ prev\) \* 100/);
  assert.match(monthly, /delta != null && delta > 10 && !r\.auditCount && r\.billed > 1000/);
  assert.match(monthly, /\['الناقل','مفوتر','التغيّر عن السابق %','تحصيل COD','مبالغ مُرجَعة\/خصومات','مدفوعات','COD ناقص الفواتير','المراجعات','فرق التدقيق','شحنات فيها فرق'\]/);
  assert.match(monthly, /fmtExact\(monthNets\.get\(m\)\)/);
});

test('forecast keeps its renderer math while exposing an accessible chart description', async () => {
  const forecast = await read('src/pages/Forecast.jsx');
  assert.match(forecast, /const span = \(maxBal - minBal\) \|\| 1/);
  assert.match(forecast, /const y = \(v\) => padT \+ innerH - \(\(v - minBal\) \/ span\) \* innerH/);
  assert.match(forecast, /role="img" aria-labelledby="cashflow-chart-title cashflow-chart-description"/);
  assert.match(forecast, /<title id="cashflow-chart-title">/);
  assert.match(forecast, /<desc id="cashflow-chart-description">/);
});

test('the report catalog exposes only existing reports and hides empty domains', async () => {
  const workspace = await read('src/pages/ReportsWorkspace.jsx');
  assert.match(workspace, /const REPORT_CATALOG = \[/);
  assert.match(workspace, /const domains = useMemo\(\(\) => \[\.\.\.new Set\(visibleCatalog\.map\(report => report\.domain\)\)\]/);
  assert.doesNotMatch(workspace, /domain: 'executive'/);
  assert.match(workspace, /searchParams\.get\('q'\)/);
  assert.match(workspace, /searchParams\.get\('domain'\)/);
});
