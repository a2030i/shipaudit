import { makeHatifSendKey, sha256Hex } from './hatifReliability.ts';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

Deno.test('send key blocks the same logical campaign across immediate and scheduled paths', async () => {
  const base = {
    phone: '966500000001', templateName: 'welcome', campaignName: 'launch-2026', sourceReference: 'store-17',
  };
  const immediate = await makeHatifSendKey({ ...base, source: 'immediate' });
  const scheduled = await makeHatifSendKey({ ...base, source: 'scheduled' });
  assert(immediate === scheduled, 'delivery path must not weaken campaign idempotency');
});

Deno.test('send key keeps intentionally separate recipients on the same phone distinct', async () => {
  const base = {
    source: 'immediate' as const, phone: '966500000001', templateName: 'store_notice', campaignName: 'stores-2026',
  };
  const first = await makeHatifSendKey({ ...base, sourceReference: 'store-17' });
  const second = await makeHatifSendKey({ ...base, sourceReference: 'store-18' });
  assert(first !== second, 'per-store messages need separate claims');
});

Deno.test('webhook digest is stable SHA-256 hex', async () => {
  const one = await sha256Hex('whatsapp\n{"messageId":"m1"}');
  const two = await sha256Hex('whatsapp\n{"messageId":"m1"}');
  assert(one === two && /^[a-f0-9]{64}$/.test(one), 'digest must be deterministic lowercase SHA-256');
});
