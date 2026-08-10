import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Tahseel gateway is authenticated and only performs allow-listed GET requests', async () => {
  const source = await read('supabase/functions/tahseel-read/index.ts');
  assert.match(source, /requireReadAccess/);
  assert.match(source, /system\.view_settings/);
  assert.match(source, /const method = 'GET'/);
  assert.doesNotMatch(source, /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/);
  assert.match(source, /READ_ROUTES/);
  assert.match(source, /unsupported_read_action/);
});

test('Tahseel gateway keeps credentials server-side and restricts upstream hosts', async () => {
  const source = await read('supabase/functions/tahseel-read/index.ts');
  assert.match(source, /Deno\.env\.get\('TAHSEEL_API_KEY'\)/);
  assert.match(source, /Deno\.env\.get\('TAHSEEL_API_SECRET'\)/);
  assert.match(source, /tahseel-api-prod-liwgaf757q-wx\.a\.run\.app/);
  assert.match(source, /crypto\.subtle\.sign\('HMAC'/);
  assert.doesNotMatch(source, /apiSecret[^\n]*return/);
});

test('Tahseel probe returns totals only and no customer records', async () => {
  const source = await read('supabase/functions/tahseel-read/index.ts');
  const probeBlock = source.slice(source.indexOf("if (action === 'probe')"), source.indexOf("return json({ ok: true, read_only: true, action"));
  assert.match(probeBlock, /count:/);
  assert.doesNotMatch(probeBlock, /list:/);
});
