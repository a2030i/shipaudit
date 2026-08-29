const PREFIX = 'shipaudit:workspace-state:v1:';

const safeKey = value => String(value || '').replace(/[^a-z0-9:_-]/gi, '_').slice(0, 160);

export function saveWorkspaceState(key, state = {}) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(`${PREFIX}${safeKey(key)}`, JSON.stringify({
      ...state,
      scrollY: Number.isFinite(state.scrollY) ? state.scrollY : window.scrollY,
      savedAt: new Date().toISOString(),
    }));
  } catch { /* best-effort navigation memory */ }
}

export function readWorkspaceState(key, { consume = false } = {}) {
  if (typeof window === 'undefined') return null;
  const storageKey = `${PREFIX}${safeKey(key)}`;
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (consume) sessionStorage.removeItem(storageKey);
    return value && typeof value === 'object' ? value : null;
  } catch {
    if (consume) sessionStorage.removeItem(storageKey);
    return null;
  }
}

export function restoreWorkspaceScroll(state) {
  if (!state || !Number.isFinite(state.scrollY)) return;
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    window.scrollTo({ top: state.scrollY, behavior: 'auto' });
  }));
}
