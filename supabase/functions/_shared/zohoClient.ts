export type ZohoApiStats = {
  apiCalls: number;
  rateLimited: number;
};

type ZohoFetchOptions = {
  url: string;
  token: string;
  method?: string;
  body?: BodyInit | null;
  headers?: Record<string, string>;
  stats: ZohoApiStats;
  maxRetries?: number;
  timeoutMs?: number;
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function retryDelay(response: Response, attempt: number) {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 15_000);
  }
  return Math.min(750 * (2 ** attempt), 6_000) + Math.floor(Math.random() * 250);
}

/**
 * The only Zoho Books fetch primitive used by synchronization paths.
 * It counts every HTTP attempt and retries only transient failures (429/5xx).
 */
export async function fetchZohoJson({
  url,
  token,
  method = 'GET',
  body = null,
  headers = {},
  stats,
  maxRetries = 2,
  timeoutMs = 25_000,
}: ZohoFetchOptions) {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        body,
        headers: { Authorization: `Zoho-oauthtoken ${token}`, ...headers },
        signal: controller.signal,
      });
      stats.apiCalls++;
      const payload = await response.json().catch(() => ({} as Record<string, unknown>));
      if (response.status === 429) stats.rateLimited++;
      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        await wait(retryDelay(response, attempt));
        continue;
      }
      return { response, payload };
    } catch (error) {
      stats.apiCalls++;
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= maxRetries) throw lastError;
      await wait(Math.min(750 * (2 ** attempt), 6_000));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error('Zoho request failed');
}

/**
 * Binary/raw variant for official document endpoints (PDFs and attachments).
 * It deliberately shares the same timeout, retry and API-usage accounting as
 * JSON synchronization calls, while leaving response parsing to the caller.
 */
export async function fetchZohoRaw({
  url,
  token,
  method = 'GET',
  body = null,
  headers = {},
  stats,
  maxRetries = 2,
  timeoutMs = 25_000,
}: ZohoFetchOptions) {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        body,
        headers: { Authorization: `Zoho-oauthtoken ${token}`, ...headers },
        signal: controller.signal,
      });
      stats.apiCalls++;
      if (response.status === 429) stats.rateLimited++;
      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        await response.body?.cancel().catch(() => {});
        await wait(retryDelay(response, attempt));
        continue;
      }
      return response;
    } catch (error) {
      stats.apiCalls++;
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= maxRetries) throw lastError;
      await wait(Math.min(750 * (2 ** attempt), 6_000));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error('Zoho request failed');
}

export function isZohoAuthorizationError(response: Response, payload: Record<string, unknown>) {
  const code = Number(payload?.code);
  const message = String(payload?.message || payload?.error || '').toLowerCase();
  return response.status === 401 || response.status === 403
    || code === 57 || code === 1057
    || message.includes('not authorized')
    || message.includes('authorization')
    || message.includes('scope');
}

export async function recordZohoUsage(
  db: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ error?: { message?: string } | null }> },
  orgId: string,
  stats: ZohoApiStats,
) {
  if (!stats.apiCalls) return;
  const configured = Number(Deno.env.get('ZOHO_DAILY_API_BUDGET'));
  const { error } = await db.rpc('zoho_record_api_usage', {
    p_org_id: orgId,
    p_api_calls: stats.apiCalls,
    p_rate_limited: stats.rateLimited,
    p_budget: Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : null,
  });
  if (error) console.error('[zoho] api usage log:', error.message || error);
}
