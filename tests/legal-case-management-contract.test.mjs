import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('legal workflow stores cases and an append-only event timeline', async () => {
  const migration = await read('supabase/migrations/20260815004131_legal_case_management.sql');

  assert.match(migration, /create table if not exists public\.legal_cases/);
  assert.match(migration, /create table if not exists public\.legal_case_events/);
  assert.match(migration, /public\.crm_has_permission\('legal\.manage'\)/);
  assert.match(migration, /alter table public\.legal_cases enable row level security/);
  assert.match(migration, /alter table public\.legal_case_events enable row level security/);
  assert.match(migration, /No UPDATE\/DELETE policy for events/);
  assert.match(migration, /revoke update, delete on public\.legal_case_events/);
});

test('retired legal workflow is no longer exposed in UI permissions', async () => {
  const permissions = await read('src/lib/permissions.js');
  assert.doesNotMatch(permissions, /key: 'legal\.view'/);
  assert.doesNotMatch(permissions, /key: 'legal\.manage'/);
});

test('legacy legal route resolves to the current receivables workspace', async () => {
  const app = await read('src/App.jsx');
  const collections = await read('src/pages/CollectionsHub.jsx');
  assert.match(app, /rawPath === '\/legal'[\s\S]*\/customer-money\?view=money&source=retired-legal/);
  assert.doesNotMatch(collections, /LegalEscalation|id: 'legal'/);
});
