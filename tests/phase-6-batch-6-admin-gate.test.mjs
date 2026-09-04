import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const sha256 = async path => createHash('sha256').update(await read(path)).digest('hex');

const FROZEN_ADMIN_SOURCES = {
  'src/lib/auth.jsx': 'b2476147205a4ac0da054d76bd4588dc32d4ff50390c39d6a01747d986a3f0f9',
  'src/lib/permissions.js': '7497c458f3ec8c76764157973e61db188825aebb14c5159ad2ff65b33a74ae66',
  'src/lib/employeeService.js': 'e7b62fbad97442bf57fc3c119b923ba5a85e743d2fa91f337cc353d5a10620b0',
  'src/lib/workAgentService.js': 'ec1b212e7fb3dd1aece64621f15bb35a4b461480836cb1d28eb3c00eb92ed544',
  'src/lib/whatsappService.js': '0c8d4da27be15c0dfc58939d797a3c3d9946a16483bdcf01d036eaf1a42d8aaf',
  'src/lib/webhookService.js': '387ba862c1e918ae87c99a7d9754f1291b0ef339e47e98f92697caa30744c353',
  'src/lib/uploadsHubService.js': '2e89bf25e08be49e518f29d56f159b2bf9a9fbbaad8b7e8ae9c518b992fe3a8b',
  'src/lib/integrityService.js': '351c08e3b14eb96e1c77ac9beb054e63dbfe2470a77a96ad5261610957357a7e',
  'src/lib/tahseelService.js': '8d71cbd1a7097c9793ab8c91bcf02436eebd4d9cc3d3c34b931f875464d1ce2a',
  'src/lib/contractHistoryService.js': '69bbac5c53f3e9f685987ae69ce347c16d45f5426f8a42e4cc9bf95222869573',
  'src/lib/coreService.js': '5b9d522a6ada37c518704de1c233e3b03a8078aabd887a164dd24a24d635eee9',
  'src/data/carriers.js': '55cb836399be5f24de24d3b96b277df87e403d57e811feb2b33be3520a243675',
  'src/engine/pricing.js': '3d2c48258d28d43c715534da14f93adda3aa6ddd06b29c0225fc2214bf2735e1',
  'src/engine/openrouter.js': 'd888b12c2e8b938add84bb21c147497ad38f913136698e89d477d5d833bb9a31',
};

test('Batch 6 freezes authentication, authorization and every admin integration service', async () => {
  for (const [path, expected] of Object.entries(FROZEN_ADMIN_SOURCES)) {
    assert.equal(await sha256(path), expected, `${path} changed during presentation-only migration`);
  }
});

test('admin has one canonical workspace and hides detail utilities from primary discovery', async () => {
  const [app, navigation, workspace, workspaceNav] = await Promise.all([
    read('src/App.jsx'), read('src/lib/navigation.js'), read('src/pages/AdminWorkspace.jsx'), read('src/components/enterprise/AdminWorkspaceNav.jsx'),
  ]);
  assert.match(app, /lazy\(\(\) => import\('\.\/pages\/AdminWorkspace\.jsx'\)\)/);
  assert.match(app, /<AdminWorkspace isActive=\{pathname==='\/workspace\/admin'\}/);
  assert.match(navigation, /settings:\s*\[[\s\S]*id: 'admin-workspace'[\s\S]*memberIds: \['admin-workspace'\][\s\S]*path: '\/workspace\/admin'/);
  for (const id of ['employees', 'carriers', 'contracts', 'operations', 'uploads', 'webhook', 'integrity', 'work-agents', 'hatif-settings', 'activity-log', 'app-settings']) {
    assert.match(navigation, new RegExp(`'?${id}'?:\\s*\\{[^}]*visible: false`));
  }
  for (const label of ['نظرة عامة', 'المستخدمون والوصول', 'التكاملات', 'العقود والملفات', 'صحة النظام', 'أدوات متقدمة']) {
    assert.match(`${workspace}\n${workspaceNav}`, new RegExp(label));
  }
  assert.doesNotMatch(workspace, /<table\b/);
});

test('admin detail pages share one workspace navigation without legacy CenterWorkspace wrappers', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /contextSection\?\.id === 'settings'[\s\S]*<AdminWorkspaceNav\/>/);
  assert.doesNotMatch(app, /scope="admin-(?:carriers|integrations|system-settings)"/);
  for (const path of ['/employees', '/carriers', '/contracts', '/operations', '/uploads', '/webhook', '/work-agents', '/integrity', '/activity-log', '/settings/hatif', '/settings/ai', '/settings/data', '/zoho-callback']) {
    assert.ok(app.includes(`'${path}'`) || app.includes(`"${path}"`), `${path} must stay registered`);
  }
});

test('users render through the central DataTable and keep sensitive actions in the overflow menu', async () => {
  const page = await read('src/pages/EmployeeManager.jsx');
  assert.match(page, /design-system\/EnterpriseUI\.jsx/);
  assert.match(page, /<DataTable caption="المستخدمون والصلاحيات"/);
  assert.match(page, /<OverflowMenu label=\{`إجراءات \$\{emp\.name\}`\}/);
  assert.match(page, /disabled: isMe/);
  assert.match(page, /canManagePermissions/);
  assert.match(page, /canManageEmployees/);
  assert.doesNotMatch(page, /<table\b/);
});

test('integration health uses central result tables while preserving source reads and unavailable semantics', async () => {
  const page = await read('src/pages/OperationsCenter.jsx');
  for (const dependency of [
    'loadZohoWebhookHealth', 'loadLamhaDirectorySyncState', 'loadUploadsOverview',
    'loadHatifCallSyncHealth', 'loadWhatsAppDeliveryHealth', 'loadWebhookEvents',
    'loadCronHealth', 'loadRecentAgentRuns', 'loadWorkAgents', 'probeTahseelConnection',
  ]) assert.match(page, new RegExp(dependency));
  assert.match(page, /Promise\.allSettled/);
  assert.match(page, /تعذّر تحديث .* مصدر/);
  assert.match(page, /لم تُحوّل المصادر الغائبة إلى حالة سليمة/);
  assert.match(page, /caption="حالة التكاملات"/);
  assert.match(page, /caption="استثناءات التكاملات"/);
  assert.match(page, /caption="أحداث التكاملات"/);
  assert.match(page, /caption="المهام المجدولة"/);
  assert.match(page, /caption="آخر تشغيلات الوكلاء"/);
  assert.doesNotMatch(page, /<table\b/);
  assert.doesNotMatch(page, /OperationsCenter\.css/);
});

test('workspace query views are permission-filtered and cannot expand the existing model', async () => {
  const [app, workspace] = await Promise.all([read('src/App.jsx'), read('src/pages/AdminWorkspace.jsx')]);
  assert.match(app, /id: 'admin-workspace'[\s\S]*permAny: \[/);
  assert.match(workspace, /function viewAllowed\(view, isAdmin, can\)/);
  assert.match(workspace, /if \(view === 'access'\) return isAdmin/);
  assert.match(workspace, /ADMIN_WORKSPACE_VIEWS\.some\([\s\S]*viewAllowed\(requestedView, isAdmin, can\)/);
  assert.match(workspace, /const allowed = item => isAdmin \|\| item\.any\?\.some\(permission => can\(permission\)\)/);
  assert.match(workspace, /حالة الاتصال لا تمنح صلاحية تنفيذ/);
});
