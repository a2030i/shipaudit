import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20260807153000_team_operational_readiness.sql', import.meta.url),
  'utf8',
);
const staffingMigration = await readFile(
  new URL('../supabase/migrations/20260807170000_team_staffing_readiness.sql', import.meta.url),
  'utf8',
);
const service = await readFile(new URL('../src/lib/overviewService.js', import.meta.url), 'utf8');
const panel = await readFile(new URL('../src/components/TeamReadinessPanel.jsx', import.meta.url), 'utf8');
const overview = await readFile(new URL('../src/pages/Overview.jsx', import.meta.url), 'utf8');
const permissions = await readFile(new URL('../src/lib/permissions.js', import.meta.url), 'utf8');
const employeeManager = await readFile(new URL('../src/pages/EmployeeManager.jsx', import.meta.url), 'utf8');
const employeeService = await readFile(new URL('../src/lib/employeeService.js', import.meta.url), 'utf8');
const permissionAudit = await readFile(
  new URL('../supabase/migrations/20260807193000_employee_permission_audit.sql', import.meta.url),
  'utf8',
);

test('readiness RPC is authenticated, read-only and validates explicit carrier schedules', () => {
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /crm_has_permission\('overview\.view'\)/);
  assert.match(migration, /schedule_basis in \('weekday', 'month_days'\)/);
  assert.match(migration, /cardinality\(schedule\.due_days\) > 0/);
  assert.match(migration, /when 'audit_with_cod' then array\['invoice'\]/);
  assert.match(migration, /when 'audit_and_cod_separate' then array\['invoice', 'cod_remittance'\]/);
  assert.doesNotMatch(migration, /insert\s+into|update\s+public|delete\s+from/i);
});

test('overview loads team readiness in the existing parallel request fan-out', () => {
  assert.match(service, /team_operational_readiness_snapshot/);
  assert.match(service, /team_staffing_readiness_snapshot/);
  assert.match(service, /mergeReadiness/);
  assert.match(service, /teamReadiness/);
  assert.match(service, /Promise\.all/);
});

test('staffing readiness excludes admin and checks end-to-end job capabilities', () => {
  assert.match(staffingMigration, /where role <> 'admin'/);
  assert.match(staffingMigration, /"system\.period_close": true/);
  assert.match(staffingMigration, /"bank\.reconcile": true/);
  assert.match(staffingMigration, /"collections\.assign": true/);
  assert.match(staffingMigration, /crm_has_permission\('overview\.view'\)/);
  assert.doesNotMatch(staffingMigration, /update\s+public|insert\s+into|delete\s+from/i);
});

test('team cutover presets add complete functional bundles without replacing existing grants', () => {
  assert.match(permissions, /ACCOUNTING_SUPERVISOR_KEYS/);
  assert.match(permissions, /FINANCE_OPERATOR_KEYS/);
  assert.match(permissions, /COLLECTION_SUPERVISOR_KEYS/);
  assert.match(permissions, /id: 'finance-operator'.*mode: 'merge'/s);
  assert.match(permissions, /'system\.period_close'/);
  assert.match(permissions, /'bank\.reconcile'/);
  assert.match(permissions, /'collections\.assign'/);
  assert.match(employeeManager, /preset\.mode === 'merge' \? \{ \.\.\.perms \} : \{\}/);
  assert.match(employeeManager, /القالب الذي يبدأ بـ \+ يضيف على الحالي/);
});

test('employee manager recommends the closest operator but requires an explicit permission save', () => {
  assert.match(employeeManager, /closestEmployeeForRole/);
  assert.match(employeeManager, /تجهيز أدوار التشغيل/);
  assert.match(employeeManager, /ترشيح تقني حسب الصلاحيات الحالية فقط/);
  assert.match(employeeManager, /إضافة الناقص للمراجعة/);
  assert.match(employeeManager, /لن تتفعّل قبل ضغط «حفظ الصلاحيات»/);
  assert.match(employeeManager, /onClick=\{handleSave\}/);
  assert.doesNotMatch(employeeManager, /useEffect\([^)]*applyPreset/s);
});

test('permission saves are server-authorized and record the exact employee permission delta', () => {
  assert.match(employeeService, /rpc\('update_employee_permissions'/);
  assert.doesNotMatch(employeeService, /from\('profiles'\)[\s\S]{0,120}update\(\{ permissions/);
  assert.match(permissionAudit, /crm_has_permission\('system\.manage_permissions'\)/);
  assert.match(permissionAudit, /profile_authorization_change_audit/);
  assert.match(permissionAudit, /'permissions_changed'/);
  assert.match(permissionAudit, /'added_keys'/);
  assert.match(permissionAudit, /'removed_keys'/);
  assert.match(permissionAudit, /'actor_id'/);
  assert.match(permissionAudit, /values\s*\(\s*new\.id,/);
  assert.match(permissionAudit, /profile\.role <> 'admin'/);
  assert.match(permissionAudit, /revoke all on function public\.log_profile_authorization_change\(\) from public, anon, authenticated/i);
  assert.doesNotMatch(permissionAudit, /grant\s+(insert|update|delete)\s+on\s+public\.profiles/i);
  assert.match(employeeManager, /أضيف:/);
  assert.match(employeeManager, /أزيل:/);
  assert.match(employeeManager, /نفّذ التغيير:/);
});

test('admin dashboard exposes three clear readiness decisions and never assumes missing data is ready', () => {
  assert.match(panel, /المحاسبة/);
  assert.match(panel, /المالية/);
  assert.match(panel, /المبيعات والتحصيل/);
  assert.match(panel, /مشغّل دورة/);
  assert.match(panel, /مشغّل مالي/);
  assert.match(panel, /مشرف توزيع/);
  assert.match(panel, /ضبط جداول الناقلين/);
  assert.match(panel, /تعيين مشرف الإقفال/);
  assert.match(panel, /تهيئة موظف المالية/);
  assert.match(panel, /تهيئة مشرف ومستلم الحملات/);
  assert.match(panel, /المصدر غير متاح/);
  assert.match(panel, /تعذّر قراءة بيانات الجاهزية/);
  assert.match(overview, /profile\?\.role === 'admin'/);
  assert.match(overview, /<TeamReadinessPanel/);
});
