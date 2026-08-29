const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000;

export function isOperationalDataStale(updatedAt, staleAfterMs = DEFAULT_STALE_AFTER_MS, now = Date.now()) {
  if (!updatedAt) return true;
  const updatedTime = new Date(updatedAt).getTime();
  if (!Number.isFinite(updatedTime)) return true;
  return now - updatedTime > Math.max(0, Number(staleAfterMs) || DEFAULT_STALE_AFTER_MS);
}

export function toggleResultSelection(selection, key) {
  const next = new Set(selection || []);
  next.has(key) ? next.delete(key) : next.add(key);
  return next;
}

export function selectVisibleResults(selection, visibleKeys, checked) {
  const next = new Set(selection || []);
  for (const key of visibleKeys || []) checked ? next.add(key) : next.delete(key);
  return next;
}

export function summarizeBulkPreflight(items = [], evaluate = item => ({ status: 'eligible', item })) {
  const reviewed = items.map((item, index) => {
    const result = evaluate(item, index) || {};
    const status = ['eligible', 'ineligible', 'review'].includes(result.status)
      ? result.status
      : result.eligible === false ? 'ineligible' : 'eligible';
    return {
      item,
      status,
      reason: result.reason || result.exclusionReason || null,
      meta: result.meta || null,
    };
  });
  const eligible = reviewed.filter(row => row.status === 'eligible');
  const ineligible = reviewed.filter(row => row.status === 'ineligible');
  const requiresReview = reviewed.filter(row => row.status === 'review');
  return {
    total: reviewed.length,
    reviewed,
    eligible,
    ineligible,
    requiresReview,
    executableCount: eligible.length,
  };
}

export function summarizeActionResults(results = []) {
  const normalized = results.map(result => ({
    ...result,
    status: ['success', 'failed', 'skipped'].includes(result?.status)
      ? result.status
      : result?.ok ? 'success' : 'failed',
  }));
  return {
    results: normalized,
    total: normalized.length,
    succeeded: normalized.filter(result => result.status === 'success').length,
    failed: normalized.filter(result => result.status === 'failed').length,
    skipped: normalized.filter(result => result.status === 'skipped').length,
  };
}

export function createSubmissionGuard() {
  let pending = null;
  return {
    get busy() { return pending != null; },
    run(operation) {
      if (pending) return pending;
      pending = Promise.resolve().then(operation).finally(() => { pending = null; });
      return pending;
    },
  };
}

export async function executeEligibleIndividually({
  preflight,
  execute,
  keyOf = item => item?.id,
  concurrency = 1,
  onProgress,
}) {
  const eligible = preflight?.eligible || [];
  const results = (preflight?.ineligible || []).map(row => ({
    key: keyOf(row.item), item: row.item, status: 'skipped', reason: row.reason || 'غير مؤهل',
  }));
  let cursor = 0;
  let completed = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(Number(concurrency) || 1, eligible.length || 1)) }, async () => {
    while (cursor < eligible.length) {
      const index = cursor++;
      const row = eligible[index];
      try {
        const value = await execute(row.item, index);
        results.push({ key: keyOf(row.item), item: row.item, status: 'success', value });
      } catch (error) {
        results.push({ key: keyOf(row.item), item: row.item, status: 'failed', reason: error?.message || 'فشل التنفيذ', error });
      } finally {
        completed += 1;
        onProgress?.({ completed, total: eligible.length, results: summarizeActionResults(results) });
      }
    }
  });
  await Promise.all(workers);
  return summarizeActionResults(results);
}
