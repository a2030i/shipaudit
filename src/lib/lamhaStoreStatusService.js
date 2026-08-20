import { supabase } from './supabase.js';

async function callLamhaStoreStatus(action, storeId) {
  const id = Number(storeId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('رقم متجر لمحة غير صالح');
  const { data, error } = await supabase.functions.invoke('lamha-store-status', { body: { action, storeId: id } });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || 'تعذر الوصول إلى حالة متجر لمحة');
  return data;
}

export const loadLamhaStoreStatus = storeId => callLamhaStoreStatus('get', storeId);
export const updateLamhaStoreStatus = (storeId, active) => callLamhaStoreStatus(active ? 'activate' : 'deactivate', storeId);

export const LAMHA_BATCH_SIZE = 10;

async function callLamhaStoreBatch(action, storeIds) {
  const ids = [...new Set((storeIds || [])
    .map(Number)
    .filter(id => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) throw new Error('اختر متجرًا واحدًا على الأقل');
  if (ids.length > LAMHA_BATCH_SIZE) throw new Error(`الدفعة الواحدة لا تتجاوز ${LAMHA_BATCH_SIZE} متاجر`);
  const { data, error } = await supabase.functions.invoke('lamha-store-status', {
    body: { action: `batch-${action}`, storeIds: ids },
  });
  if (error) throw error;
  if (!data || !Array.isArray(data.results)) throw new Error(data?.error || 'لم تصل نتيجة فحص متاجر لمحة');
  return data;
}

export const loadLamhaStoreStatuses = storeIds => callLamhaStoreBatch('get', storeIds);
export const updateLamhaStoreStatuses = (storeIds, active) => callLamhaStoreBatch(active ? 'activate' : 'deactivate', storeIds);

export function estimateLamhaOperationSeconds(storeCount, mode = 'get') {
  const requestsPerStore = mode === 'get' ? 1 : 3;
  return Math.ceil(Math.max(0, Number(storeCount) || 0) * requestsPerStore * 2.1);
}

export async function runLamhaStoreOperation({
  storeIds,
  mode = 'get',
  onProgress,
  shouldStop = () => false,
}) {
  const ids = [...new Set((storeIds || [])
    .map(Number)
    .filter(id => Number.isSafeInteger(id) && id > 0))];
  const output = [];
  for (let index = 0; index < ids.length; index += LAMHA_BATCH_SIZE) {
    if (shouldStop()) break;
    const batch = ids.slice(index, index + LAMHA_BATCH_SIZE);
    let result;
    try {
      result = mode === 'get'
        ? await loadLamhaStoreStatuses(batch)
        : await updateLamhaStoreStatuses(batch, mode === 'activate');
      output.push(...result.results);
    } catch (error) {
      output.push(...batch.map(storeId => ({
        ok: false,
        storeId,
        error: error?.message || 'تعذر تنفيذ الدفعة',
      })));
    }
    onProgress?.({
      completed: Math.min(index + batch.length, ids.length),
      total: ids.length,
      results: output,
    });
  }
  return {
    stopped: output.length < ids.length,
    requested: ids.length,
    completed: output.length,
    succeeded: output.filter(item => item.ok).length,
    failed: output.filter(item => !item.ok).length,
    changed: output.filter(item => item.ok && item.changed).length,
    results: output,
  };
}
