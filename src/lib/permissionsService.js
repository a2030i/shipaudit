import { supabase } from './supabase.js';

// ── Per-role nav permissions ──
// Stored in the app_settings table under a single key as JSON:
//   { accountant1: ['dashboard', 'upload'], accountant2: [...] }
// Admin always sees everything regardless of this map.
const NAV_KEY = 'NAV_PERMISSIONS';
const NAV_DEFAULTS = { accountant1: [], accountant2: [] };

export async function getNavPermissions() {
  const { data } = await supabase
    .from('app_settings').select('value').eq('key', NAV_KEY).single();
  try { return data ? JSON.parse(data.value) : NAV_DEFAULTS; } catch { return NAV_DEFAULTS; }
}

export async function saveNavPermissions(perms) {
  await supabase.from('app_settings')
    .upsert({ key: NAV_KEY, value: JSON.stringify(perms) }, { onConflict: 'key' });
}
