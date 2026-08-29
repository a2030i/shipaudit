import { supabase } from './supabase.js';

const validStoreIds = storeIds => [...new Set((storeIds || [])
  .map(value => String(value || '').trim())
  .filter(Boolean))];

export async function loadLamhaWalletSources(storeIds, client = supabase) {
  const ids = validStoreIds(storeIds);
  if (!ids.length) return { rows: [], byStoreId: new Map(), generatedAt: null };
  const rows = [];
  let generatedAt = null;
  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await client.rpc('lamha_store_profile_sources', {
      p_store_ids: ids.slice(index, index + 100),
    });
    if (error) throw error;
    rows.push(...(Array.isArray(data?.rows) ? data.rows : []));
    generatedAt = data?.generatedAt || generatedAt;
  }
  return {
    rows,
    byStoreId: new Map(rows.map(row => [String(row.storeId), row])),
    generatedAt,
  };
}

export function summarizeLamhaWalletSources(rows = []) {
  const available = rows.filter(row => row.walletSource === 'excel' && row.walletImportedAt);
  const timestamps = available.map(row => new Date(row.walletImportedAt).getTime()).filter(Number.isFinite);
  const files = [...new Set(available.map(row => row.walletSourceFile).filter(Boolean))];
  return {
    availableCount: available.length,
    missingCount: Math.max(0, rows.length - available.length),
    oldestImportedAt: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null,
    newestImportedAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
    sourceFile: files.length === 1 ? files[0] : null,
    sourceFiles: files,
  };
}
