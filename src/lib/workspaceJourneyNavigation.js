const INTERNAL_ORIGIN = 'https://shipaudit.local';

const RECONCILIATION_STATUSES = new Set([
  'matched',
  'needs_investigation',
  'missing_sources',
  'differences',
  'internal_only',
  'zoho_only',
]);

export function readReconciliationJourneyContext(search = '') {
  const params = new URLSearchParams(search);
  const requestedStatus = params.get('status');
  return {
    tab: params.get('tab') === 'vendors' ? 'vendors' : 'customers',
    view: params.get('view') === 'legacy-store' ? 'store' : 'customer',
    status: RECONCILIATION_STATUSES.has(requestedStatus)
      ? requestedStatus
      : params.get('differences') === '1' ? 'differences' : '',
    search: params.get('search') || params.get('store') || '',
    onlyGaps: params.get('gaps') === '1',
  };
}

export function updateReconciliationJourneySearch(search = '', patch = {}) {
  const params = new URLSearchParams(search);

  if (Object.hasOwn(patch, 'tab')) {
    params.set('tab', patch.tab === 'vendors' ? 'vendors' : 'customers');
  }
  if (Object.hasOwn(patch, 'view')) {
    if (patch.view === 'store') params.set('view', 'legacy-store');
    else params.delete('view');
  }
  if (Object.hasOwn(patch, 'status')) {
    if (RECONCILIATION_STATUSES.has(patch.status)) params.set('status', patch.status);
    else params.delete('status');
    params.delete('differences');
  }
  if (Object.hasOwn(patch, 'search')) {
    const value = String(patch.search || '').trim();
    if (value) params.set('search', value);
    else {
      params.delete('search');
      params.delete('store');
    }
  }
  if (Object.hasOwn(patch, 'onlyGaps')) {
    if (patch.onlyGaps) params.set('gaps', '1');
    else params.delete('gaps');
  }

  return params.toString();
}

export function withWorkspaceReturn(path, { source, returnTo } = {}) {
  const target = new URL(path, INTERNAL_ORIGIN);
  if (source) target.searchParams.set('source', source);
  if (returnTo?.startsWith('/')) target.searchParams.set('returnTo', returnTo);
  return `${target.pathname}?${target.searchParams.toString()}`;
}

export function operationalDetailPath(path, returnTo) {
  const target = new URL(path, INTERNAL_ORIGIN);
  if (target.pathname === '/carrier') {
    const carrierId = target.searchParams.get('id') || target.searchParams.get('carrier');
    target.searchParams.delete('carrier');
    if (carrierId) target.searchParams.set('id', carrierId);
  }
  return withWorkspaceReturn(`${target.pathname}?${target.searchParams.toString()}`, {
    source: 'operations',
    returnTo,
  });
}

export function reportReturnPath(source, returnTo) {
  return source === 'reports' && returnTo?.startsWith('/') ? returnTo : null;
}
