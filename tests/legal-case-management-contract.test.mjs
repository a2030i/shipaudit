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

test('legal management permission is separate from legal read access', async () => {
  const permissions = await read('src/lib/permissions.js');
  assert.match(permissions, /key: 'legal\.view'/);
  assert.match(permissions, /key: 'legal\.manage'/);
});

test('legal page exposes case metadata, appointments and immutable actions', async () => {
  const page = await read('src/pages/LegalEscalation.jsx');
  const service = await read('src/lib/legalService.js');

  assert.match(page, /CaseWorkspace/);
  assert.match(page, /nextActionAt/);
  assert.match(page, /caseNumber/);
  assert.match(page, /documentUrl/);
  assert.match(page, /addLegalCaseEvent/);
  assert.match(page, /loadLegalCases/);
  assert.match(service, /from\('legal_cases'\)/);
  assert.match(service, /from\('legal_case_events'\)/);
});
