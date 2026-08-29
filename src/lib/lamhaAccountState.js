export function normalizeLamhaStatus(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

// Lamha's account switch uses a negative contract: only exact `inactive`
// means shipment creation is disabled. active/idle/stopped are lifecycle or
// activity labels while the account itself remains enabled.
export function lamhaAccountState(value) {
  const status = normalizeLamhaStatus(value);
  if (!status) return 'unknown';
  if (status === 'inactive' || status === 'غير نشط') return 'disabled';
  return 'enabled';
}

export const isLamhaAccountEnabled = value => lamhaAccountState(value) === 'enabled';
export const isLamhaAccountDisabled = value => lamhaAccountState(value) === 'disabled';
export const isLamhaLifecycleStopped = value => normalizeLamhaStatus(value) === 'stopped';
