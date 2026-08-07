import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('customer balance integrity uses Zoho dedicated opening-balances endpoint', async () => {
  const source = await readFile(new URL('../supabase/functions/zoho-sync/index.ts', import.meta.url), 'utf8');

  assert.match(source, /contacts\/\$\{candidate\.zoho_id\}\/openingbalances\?organization_id=/);
  assert.match(source, /openingBalanceConfigured\(openingPayload\)/);
  assert.match(source, /hasOwnProperty\.call\(row, 'opening_balance_amount'\)/);
  assert.doesNotMatch(source, /openingBalanceConfigured\(detail as Record<string, unknown>\)/);
});
