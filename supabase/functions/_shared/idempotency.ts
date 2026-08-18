type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
};

export type ExternalEffectResult = {
  executed: boolean;
  duplicate: boolean;
  state: string;
  ok: boolean;
  status: number | null;
  body: any;
};

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

export async function sha256Hex(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : stableJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function riyadhDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function intervalBucketKey(date: Date, intervalMinutes: number): string {
  const width = Math.max(1, Math.trunc(intervalMinutes || 1)) * 60_000;
  return String(Math.floor(date.getTime() / width));
}

async function parseResponse(response: Response): Promise<any> {
  const text = await response.clone().text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { text: text.slice(0, 2000) }; }
}

export async function runExternalEffect(options: {
  db: RpcClient;
  flow: string;
  idempotencyKey: string;
  payload: unknown;
  dispatch: () => Promise<Response>;
  isSuccess?: (response: Response, body: any) => boolean;
}): Promise<ExternalEffectResult> {
  const claimToken = crypto.randomUUID();
  const payloadHash = await sha256Hex(options.payload);
  const { data: claim, error: claimError } = await options.db.rpc('claim_integration_effect', {
    p_idempotency_key: options.idempotencyKey,
    p_flow: options.flow,
    p_payload_hash: payloadHash,
    p_claim_token: claimToken,
  });
  if (claimError) throw new Error(`idempotency claim failed: ${claimError.message || claimError}`);

  if (!claim?.claimed) {
    const saved = claim?.result || {};
    return {
      executed: false,
      duplicate: true,
      state: String(claim?.status || 'unknown'),
      ok: claim?.status === 'succeeded',
      status: Number.isFinite(Number(saved.http_status)) ? Number(saved.http_status) : null,
      body: saved.body ?? null,
    };
  }

  const { data: marked, error: markError } = await options.db.rpc('mark_integration_effect_dispatching', {
    p_idempotency_key: options.idempotencyKey,
    p_claim_token: claimToken,
  });
  if (markError || marked !== true) {
    await options.db.rpc('release_integration_effect_before_dispatch', {
      p_idempotency_key: options.idempotencyKey,
      p_claim_token: claimToken,
    });
    throw new Error(`idempotency dispatch mark failed: ${markError?.message || 'claim lost'}`);
  }

  try {
    const response = await options.dispatch();
    const body = await parseResponse(response);
    const accepted = options.isSuccess ? options.isSuccess(response, body) : response.ok;
    const finalStatus = accepted ? 'succeeded' : 'failed';
    const { error: finishError } = await options.db.rpc('finish_integration_effect', {
      p_idempotency_key: options.idempotencyKey,
      p_claim_token: claimToken,
      p_status: finalStatus,
      p_result: { http_status: response.status, body },
      p_last_error: accepted ? null : `http ${response.status}`,
    });
    if (finishError) throw new Error(`idempotency completion failed: ${finishError.message || finishError}`);
    return { executed: true, duplicate: false, state: finalStatus, ok: accepted, status: response.status, body };
  } catch (error) {
    await options.db.rpc('finish_integration_effect', {
      p_idempotency_key: options.idempotencyKey,
      p_claim_token: claimToken,
      p_status: 'indeterminate',
      p_result: null,
      p_last_error: String((error as Error)?.message || error),
    });
    throw error;
  }
}
