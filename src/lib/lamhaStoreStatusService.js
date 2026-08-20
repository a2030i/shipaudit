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
