import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const fingerprint = text => createHash('sha256').update(text.replace(/\r\n?/g, '\n')).digest('hex');
const sha256 = async path => fingerprint(await read(path));

const FROZEN_ADMIN_SOURCES = {
  'src/lib/auth.jsx': 'b2476147205a4ac0da054d76bd4588dc32d4ff50390c39d6a01747d986a3f0f9',
  'src/lib/permissions.js': '72894608dcdb4f04176cfa8c1193ef6f19dc4ffa8238710b340d775534b960bf',
  'src/lib/employeeService.js': 'c63d1a9b80f3d1f8323879932ea05cb41726e8124c8fe92932706920229a143c',
  'src/lib/workAgentService.js': 'ec1b212e7fb3dd1aece64621f15bb35a4b461480836cb1d28eb3c00eb92ed544',
  'src/lib/whatsappService.js': 'd42b82f664834790a3393c50b0a236cfa138cf477f5fe577ec1547a642e669eb',
  'src/lib/webhookService.js': 'b90a6be488511ea6e4943b42b666d87b17c9c03510541014eb3ba88b027cc6ca',
  'src/lib/uploadsHubService.js': 'bc90d2df005d02ade13750af3f4f3c490094b4d18dae6ca73b137fc1e4c11d48',
  'src/lib/integrityService.js': '351c08e3b14eb96e1c77ac9beb054e63dbfe2470a77a96ad5261610957357a7e',
  'src/lib/tahseelService.js': '8d71cbd1a7097c9793ab8c91bcf02436eebd4d9cc3d3c34b931f875464d1ce2a',
  'src/lib/contractHistoryService.js': 'ef6d16ef4330eb52f3933fa21aaac027eb559712a56ddf188778f0a853df39ce',
  'src/lib/coreService.js': '7bf9d90f04e932ca127a0eb4a02336e2f8ec38a07b7eb4f3f680ba02e4565573',
  'src/data/carriers.js': 'c2b61cf75a48cde0163aa5c2698ec6368385869e82be45576f1f4540e1610eae',
  'src/engine/pricing.js': '3d2c48258d28d43c715534da14f93adda3aa6ddd06b29c0225fc2214bf2735e1',
  'src/engine/openrouter.js': '3c37cab1667ec7d37ff8674f61e75f1dcfbfb6d153f0a95f3a9970dcfe802ff5',
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
