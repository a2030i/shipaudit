const DEFAULT_MAX_WAIT_MS = 15_000;

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: Record<string, unknown> | null;
    error: { message?: string } | null;
  }>;
};

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

async function credentialFingerprint(token: string) {
  const normalized = token.trim();
  if (!normalized) throw new Error('lamha_rate_limit_missing_token');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function waitForLamhaApiSlot(
  client: RpcClient,
  token: string,
  source: string,
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
) {
  const credentialKey = await credentialFingerprint(token);
  const startedAt = Date.now();
  while (Date.now() - startedAt <= maxWaitMs) {
    const { data, error } = await client.rpc('claim_lamha_api_request', {
      p_credential_key: credentialKey,
      p_source: source,
    });
    if (error) throw new Error(`lamha_rate_limit_unavailable:${error.message || 'rpc_failed'}`);
    if (data?.allowed === true) return;

    const retryAfterMs = Math.max(50, Math.min(2_500, Number(data?.retry_after_ms) || 250));
    if (Date.now() - startedAt + retryAfterMs > maxWaitMs) break;
    await sleep(retryAfterMs);
  }
  throw new Error('lamha_rate_limit_wait_timeout');
}
