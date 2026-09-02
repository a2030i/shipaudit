import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Hatif call provider id is a full unique upsert conflict target', () => {
  const migration = read('supabase/migrations/20260902091303_fix_hatif_calls_provider_conflict.sql');
  assert.match(migration, /create\s+unique\s+index\s+hatif_calls_provider_idx\s+on\s+public\.hatif_calls\s*\(provider_call_id\)/i);
  assert.doesNotMatch(migration, /where\s*\(?.*provider_call_id\s+is\s+not\s+null/i);
});

test('Hatif call webhook keeps provider-call upserts idempotent and records useful errors', () => {
  const webhook = read('supabase/functions/hatif-call-webhook/index.ts');
  const reliability = read('supabase/functions/_shared/hatifReliability.ts');
  assert.match(webhook, /upsert\(row,\s*\{\s*onConflict:\s*'provider_call_id'\s*\}\)/);
  assert.match(webhook, /hatifErrorMessage\(e\)/);
  assert.match(webhook, /X-Cron-Key/);
  assert.match(webhook, /internal_replay/);
  assert.match(reliability, /value\.code,\s*value\.message,\s*value\.details,\s*value\.hint/);
});
