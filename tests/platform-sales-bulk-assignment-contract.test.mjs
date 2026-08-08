import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const page = fs.readFileSync(path.join(root, 'src/pages/PlatformSalesCrm.jsx'), 'utf8');
const service = fs.readFileSync(path.join(root, 'src/lib/retargetingService.js'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260808120000_platform_sales_bulk_assignment.sql'),
  'utf8',
);

test('platform sales exports the complete filtered result set', () => {
  assert.match(page, /تصدير Excel/);
  assert.match(page, /loadAllPlatformSalesPipelineRows\(activeFilters\)/);
  assert.match(service, /do \{/);
  assert.match(service, /while \(rows\.length < count/);
  assert.match(page, /persistAndDownloadExport/);
});

test('bulk assignment is explicit, permission-gated and owner-only', () => {
  assert.match(page, /can\('crm\.assign'\)/);
  assert.match(page, /إسناد كل النتائج/);
  assert.match(page, /لن يغيّر مرحلة العميل/);
  assert.match(migration, /crm_has_permission\('crm\.assign'\)/);
  assert.match(migration, /on conflict \(phone\) do update set\s+owner_id = excluded\.owner_id,/);
  assert.doesNotMatch(
    migration.match(/on conflict \(phone\) do update set[\s\S]*?insert into public\.platform_sales_assignment_batches/)?.[0] || '',
    /sales_stage\s*=|status\s*=|next_action_at\s*=|notes\s*=/,
  );
});

test('bulk assignment has an immutable batch audit record', () => {
  assert.match(migration, /create table if not exists public\.platform_sales_assignment_batches/);
  assert.match(migration, /assigned_by uuid not null/);
  assert.match(migration, /reassigned_count integer not null/);
  assert.match(migration, /phones text\[\] not null/);
  assert.match(migration, /bulk_limit_5000/);
});

