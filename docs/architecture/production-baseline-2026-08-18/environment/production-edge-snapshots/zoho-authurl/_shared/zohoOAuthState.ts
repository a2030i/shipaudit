
// OAuth state for Zoho's authorization-code flow.
// Stateless but signed, short-lived, and bound to the authenticated admin who
// initiated the flow. The authorization code itself is one-time-use at Zoho.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const fromBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
};

async function signingKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function createZohoOAuthState(userId: string, secret: string) {
  const payload = toBase64Url(encoder.encode(JSON.stringify({
    uid: userId,
    iat: Date.now(),
    nonce: crypto.randomUUID(),
  })));
  const signature = new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    await signingKey(secret),
    encoder.encode(payload),
  ));
  return `${payload}.${toBase64Url(signature)}`;
}

export async function verifyZohoOAuthState(
  state: string,
  expectedUserId: string,
  secret: string,
  maxAgeMs = 10 * 60_000,
) {
  try {
    const [payload, signature, extra] = String(state || '').split('.');
    if (!payload || !signature || extra) return false;
    const validSignature = await crypto.subtle.verify(
      'HMAC',
      await signingKey(secret),
      fromBase64Url(signature),
      encoder.encode(payload),
    );
    if (!validSignature) return false;
    const parsed = JSON.parse(decoder.decode(fromBase64Url(payload)));
    const issuedAt = Number(parsed?.iat);
    const age = Date.now() - issuedAt;
    return parsed?.uid === expectedUserId
      && Number.isFinite(issuedAt)
      && age >= -60_000
      && age <= maxAgeMs
      && typeof parsed?.nonce === 'string';
  } catch {
    return false;
  }
}

