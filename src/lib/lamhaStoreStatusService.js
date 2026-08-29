import { supabase } from './supabase.js';

const LAMHA_ERROR_LABELS = {
  forbidden: 'هذا الإجراء متاح للمدير فقط',
  LAMHA_EMPLOYEE_TOKEN_not_configured: 'توكن موظف لمحة غير مهيأ',
  lamha_store_read_failed: 'تعذر قراءة حساب المتجر من لمحة قبل التنفيذ',
  lamha_store_not_found: 'رقم المتجر غير موجود في واجهة موظف لمحة أو خارج نطاق التوكن',
  lamha_auth_failed: 'رفضت لمحة صلاحية توكن الموظف',
  lamha_rate_limited: 'وصل فحص لمحة إلى حد الطلبات المؤقت',
  lamha_upstream_unavailable: 'خدمة لمحة غير متاحة مؤقتًا',
  lamha_timeout: 'انتهت مهلة قراءة حساب المتجر من لمحة',
  lamha_network_failed: 'تعذر الاتصال بخدمة لمحة',
  lamha_identifier_mismatch: 'أعادت لمحة حسابًا لا يطابق رقم المتجر المطلوب',
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
export const LAMHA_STATUS_UPDATED_EVENT = 'shipaudit:lamha-status-updated';

const LAMHA_RECENT_STATUS_KEY = 'shipaudit:lamha-recent-status:v1';
const LAMHA_FINANCIAL_HOLDS_KEY = 'shipaudit:lamha-financial-holds:v1';

function readSessionJson(key, fallback) {
  if (typeof sessionStorage === 'undefined') return fallback;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(key) || 'null');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeSessionJson(key, value) {
  if (typeof sessionStorage === 'undefined') return;
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be unavailable */ }
}

export function readRecentLamhaStoreStatuses(storeIds = [], now = Date.now()) {
  const requested = new Set((storeIds || []).map(Number).filter(Number.isSafeInteger));
  const stored = readSessionJson(LAMHA_RECENT_STATUS_KEY, {});
  const map = new Map();
  for (const [rawId, result] of Object.entries(stored || {})) {
    const storeId = Number(rawId);
    if (requested.size && !requested.has(storeId)) continue;
    if (!isLamhaStatusResultFresh(result, now)) continue;
    map.set(storeId, result);
  }
  return map;
}

export function readRecentLamhaFinancialHolds() {
  return new Set(readSessionJson(LAMHA_FINANCIAL_HOLDS_KEY, [])
    .map(Number).filter(Number.isSafeInteger));
}

function cacheLamhaOperationResults(results, { mode = 'get', context = 'direct' } = {}) {
  const successful = (results || []).filter(result => result?.ok && Number.isSafeInteger(Number(result.storeId)));
  if (!successful.length) return;
  const stored = readSessionJson(LAMHA_RECENT_STATUS_KEY, {});
  successful.forEach(result => { stored[Number(result.storeId)] = result; });
  writeSessionJson(LAMHA_RECENT_STATUS_KEY, stored);

  const holds = readRecentLamhaFinancialHolds();
  successful.forEach(result => {
    const storeId = Number(result.storeId);
    if (mode === 'activate' || result.store?.canCreateShipments === true) holds.delete(storeId);
    else if (mode === 'deactivate' && context === 'financial_policy') holds.add(storeId);
  });
  writeSessionJson(LAMHA_FINANCIAL_HOLDS_KEY, [...holds]);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(LAMHA_STATUS_UPDATED_EVENT, {
      detail: { storeIds: successful.map(result => Number(result.storeId)), mode, context },
    }));
  }
}

export function isLamhaStatusResultFresh(result, now = Date.now()) {
  const checkedAt = new Date(result?.checkedAt || result?.checked_at || 0).getTime();
  return result?.ok === true && Number.isFinite(checkedAt) && checkedAt > 0
    && now - checkedAt <= LAMHA_STATUS_FRESH_MS;
}

export const needsLamhaStatusRefresh = (result, now = Date.now()) => (
  !isLamhaStatusResultFresh(result, now)
);

export function lamhaStatusFailureLabel(result) {
  if (!result || result.ok) return null;
  const message = LAMHA_ERROR_LABELS[result.error] || 'تعذر التحقق من حساب المتجر في لمحة';
  const http = Number.isInteger(result.http) ? ` · HTTP ${result.http}` : '';
  return `${message}${http}`;
}

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
  cacheLamhaOperationResults(data.results);
  if (Array.isArray(data.financialHoldStoreIds)) {
    writeSessionJson(LAMHA_FINANCIAL_HOLDS_KEY, data.financialHoldStoreIds.map(Number).filter(Number.isSafeInteger));
  }
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
      cacheLamhaOperationResults(result.results, { mode, context });
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
