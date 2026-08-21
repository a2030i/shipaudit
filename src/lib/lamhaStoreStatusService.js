import { supabase } from './supabase.js';

const LAMHA_ERROR_LABELS = {
  forbidden: 'هذا الإجراء متاح للمدير فقط',
  LAMHA_EMPLOYEE_TOKEN_not_configured: 'توكن موظف لمحة غير مهيأ',
  lamha_store_read_failed: 'تعذر قراءة حساب المتجر من لمحة قبل التنفيذ',
  lamha_status_write_failed: 'رفضت لمحة تحديث حالة حساب المتجر',
  lamha_status_verification_failed: 'أُرسل الطلب لكن لم تؤكد لمحة حالة الحساب الجديدة',
  lamha_rate_limit_wait_timeout: 'تعذر تنفيذ الطلب ضمن حد لمحة الآمن؛ أعد المحاولة بعد قليل',
};

async function lamhaFunctionError(error) {
  let payload = null;
  if (typeof error?.context?.json === 'function') {
    try { payload = await error.context.json(); } catch { /* response may not contain JSON */ }
  }
  const code = payload?.error;
  const message = LAMHA_ERROR_LABELS[code] || payload?.message || error?.message || 'تعذر الوصول إلى لمحة';
  const observed = payload?.observedStatus ? ` (الحالة المرصودة: ${payload.observedStatus})` : '';
  return new Error(`${message}${observed}`);
}

async function callLamhaStoreStatus(action, storeId) {
  const id = Number(storeId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('رقم متجر لمحة غير صالح');
  const { data, error } = await supabase.functions.invoke('lamha-store-status', { body: { action, storeId: id } });
  if (error) throw await lamhaFunctionError(error);
  if (!data?.ok) throw new Error(data?.error || 'تعذر الوصول إلى حالة متجر لمحة');
  return data;
}

export const loadLamhaStoreStatus = storeId => callLamhaStoreStatus('get', storeId);
export const updateLamhaStoreStatus = (storeId, active) => callLamhaStoreStatus(active ? 'activate' : 'deactivate', storeId);

export const LAMHA_BATCH_SIZE = 10;
export const LAMHA_STATUS_FRESH_MS = 15 * 60 * 1000;

export function isLamhaStatusResultFresh(result, now = Date.now()) {
  const checkedAt = new Date(result?.checkedAt || result?.checked_at || 0).getTime();
  return result?.ok === true && Number.isFinite(checkedAt) && checkedAt > 0
    && now - checkedAt <= LAMHA_STATUS_FRESH_MS;
}

export const needsLamhaStatusRefresh = (result, now = Date.now()) => (
  !isLamhaStatusResultFresh(result, now)
);

export async function loadCachedLamhaStoreStatuses(storeIds) {
  const ids = [...new Set((storeIds || [])
    .map(Number)
    .filter(id => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return { results: [], financialHoldStoreIds: [], freshForSeconds: LAMHA_STATUS_FRESH_MS / 1000 };
  const { data, error } = await supabase.functions.invoke('lamha-store-status', {
    body: { action: 'restore-scan', storeIds: ids },
  });
  if (error) throw await lamhaFunctionError(error);
  if (!data?.ok || !Array.isArray(data.results)) throw new Error(data?.error || 'تعذرت استعادة آخر فحص لمتاجر لمحة');
  return data;
}

async function callLamhaStoreBatch(action, storeIds, context = 'direct') {
  const ids = [...new Set((storeIds || [])
    .map(Number)
    .filter(id => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) throw new Error('اختر متجرًا واحدًا على الأقل');
  if (ids.length > LAMHA_BATCH_SIZE) throw new Error(`الدفعة الواحدة لا تتجاوز ${LAMHA_BATCH_SIZE} متاجر`);
  const { data, error } = await supabase.functions.invoke('lamha-store-status', {
    body: { action: `batch-${action}`, storeIds: ids, context },
  });
  if (error) throw await lamhaFunctionError(error);
  if (!data || !Array.isArray(data.results)) throw new Error(data?.error || 'لم تصل نتيجة فحص متاجر لمحة');
  return data;
}

export const loadLamhaStoreStatuses = (storeIds, context) => callLamhaStoreBatch('get', storeIds, context);
export const updateLamhaStoreStatuses = (storeIds, active, context) => callLamhaStoreBatch(active ? 'activate' : 'deactivate', storeIds, context);

export function estimateLamhaOperationSeconds(storeCount, mode = 'get') {
  const requestsPerStore = mode === 'get' ? 1 : 3;
  return Math.ceil(Math.max(0, Number(storeCount) || 0) * requestsPerStore * 2.1);
}

export async function runLamhaStoreOperation({
  storeIds,
  mode = 'get',
  context = 'direct',
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
        ? await loadLamhaStoreStatuses(batch, context)
        : await updateLamhaStoreStatuses(batch, mode === 'activate', context);
      output.push(...result.results);
    } catch (error) {
      output.push(...batch.map(storeId => ({
        ok: false,
        storeId,
        error: error?.message || 'تعذر تنفيذ الدفعة',
        cacheSaved: false,
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
    cacheSaved: output.every(item => item.cacheSaved !== false),
    results: output,
  };
}
