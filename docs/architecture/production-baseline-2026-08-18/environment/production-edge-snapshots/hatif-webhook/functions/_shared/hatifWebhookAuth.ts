// Shared Hatif/Voxa webhook authentication.
// Official WhatsApp and post-call webhooks sign the exact raw UTF-8 body with
// HMAC-SHA256 and send the lowercase hex digest in X-Voxa-Signature.

export type HatifWebhookAuthResult = {
  ok: boolean;
  mode: 'signature' | 'legacy_key' | 'rejected';
  reason?: 'invalid_signature' | 'missing_signature' | 'missing_secret' | 'invalid_legacy_key';
};

const encoder = new TextEncoder();

function constantTimeEqual(left: string, right: string): boolean {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  let mismatch = a.length ^ b.length;
  const width = Math.max(a.length, b.length);
  for (let i = 0; i < width; i += 1) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

async function hmacHex(secret: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function validLegacyKey(req: Request, db: any): Promise<boolean> {
  const key = new URL(req.url).searchParams.get('key') || '';
  if (!key) return false;
  const { data } = await db.from('zoho_auth').select('webhook_key').eq('id', 1).maybeSingle();
  const expected = String(data?.webhook_key || '');
  return !!expected && constantTimeEqual(key, expected);
}

/**
 * Safe migration behaviour:
 * - A supplied signature is always verified and can never downgrade to ?key=.
 * - HATIF_REQUIRE_SIGNATURE=true closes the legacy path completely.
 * - Until the channel signing secret is configured in both systems, requests
 *   without a signature may continue through the existing private ?key= URL.
 */
export async function authorizeHatifWebhook(
  req: Request,
  db: any,
  rawBody: string,
): Promise<HatifWebhookAuthResult> {
  const signature = (req.headers.get('X-Voxa-Signature') || '').trim();
  const secret = (Deno.env.get('HATIF_WEBHOOK_SECRET') || '').trim();
  const requireSignature = (Deno.env.get('HATIF_REQUIRE_SIGNATURE') || '').trim().toLowerCase() === 'true';

  if (signature) {
    if (!secret) return { ok: false, mode: 'rejected', reason: 'missing_secret' };
    if (!/^[a-f0-9]{64}$/i.test(signature)) {
      return { ok: false, mode: 'rejected', reason: 'invalid_signature' };
    }
    const expected = await hmacHex(secret, rawBody);
    return constantTimeEqual(signature, expected)
      ? { ok: true, mode: 'signature' }
      : { ok: false, mode: 'rejected', reason: 'invalid_signature' };
  }

  if (requireSignature) {
    return { ok: false, mode: 'rejected', reason: secret ? 'missing_signature' : 'missing_secret' };
  }

  return (await validLegacyKey(req, db))
    ? { ok: true, mode: 'legacy_key' }
    : { ok: false, mode: 'rejected', reason: 'invalid_legacy_key' };
}

