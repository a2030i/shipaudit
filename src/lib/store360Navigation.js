const SAFE_STORE_ID = /^\d+$/;

export function buildStore360Url({
  storeId,
  view = 'overview',
  source,
  returnTo,
  aging,
  invoice,
  search,
  status,
  owner,
  action,
  page,
} = {}) {
  const id = String(storeId ?? '').trim();
  if (!SAFE_STORE_ID.test(id) || Number(id) <= 0) return null;

  const params = new URLSearchParams({ customer: id, open: '1', view });
  const optional = { source, returnTo, aging, invoice, search, status, owner, action, page };
  for (const [key, value] of Object.entries(optional)) {
    if (value == null || value === '') continue;
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return `/customer-360?${params.toString()}`;
}
