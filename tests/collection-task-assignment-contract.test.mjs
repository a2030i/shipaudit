import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('collection assignment permission is explicit and unbundled from existing presets', () => {
  const permissions = read('src/lib/permissions.js');
  assert.match(permissions, /key:\s*'collections\.assign'/);
  assert.match(permissions, /إسناد مهام التحصيل لموظفي الفريق/);
});

test('collection assignment RPC is permission-guarded, scoped, and audited', () => {
  const sql = read('supabase/migrations/20260807160000_collection_task_assignment.sql');
  assert.match(sql, /crm_has_permission\('collections\.assign'\)/);
  assert.match(sql, /profile\.permissions\s*->>\s*'collections\.view'/);
  assert.match(sql, /profile\.permissions\s*->>\s*'collections\.update_stage'/);
  assert.match(sql, /task\.stage in \('todo', 'contacted', 'promised', 'snoozed'\)/);
  assert.match(sql, /set assigned_to = p_assignee,\s*updated_at = now\(\)/);
  assert.doesNotMatch(sql, /set[^;]*(debt_at_creation|promise_amount|stage)\s*=/s);
  assert.match(sql, /insert into public\.collection_task_assignment_batches/);
});

test('collections page supports explicit multi-select assignment without auto-running it', () => {
  const page = read('src/pages/Collections.jsx');
  assert.match(page, /can\('collections\.assign'\)/);
  assert.match(page, /تحديد المعروض/);
  assert.match(page, /إسناد المحدد/);
  assert.match(page, /إلغاء الإسناد/);
  assert.match(page, /aria-label={`تحديد مهمة \$\{t\.customer_name\}`}/);
  assert.match(page, /handleBulkAssignment\(bulkAssignee\)/);
  assert.doesNotMatch(page, /useEffect\([^)]*assignCollectionTasks/s);
});

test('collections service calls only the protected assignment RPC', () => {
  const service = read('src/lib/collectionsService.js');
  assert.match(service, /rpc\('collection_assignment_candidates'\)/);
  assert.match(service, /rpc\('assign_collection_tasks'/);
  assert.match(service, /p_task_ids:\s*ids/);
  assert.match(service, /p_assignee:\s*assigneeId \|\| null/);
});
