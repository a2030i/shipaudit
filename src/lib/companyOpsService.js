import { supabase } from './supabase.js';

const n = (value) => Number(value) || 0;
const CACHE_TTL_MS = 90_000;

function team(value) {
  if (!value?.visible) return null;
  return {
    ...value,
    today: n(value.today),
    backlog: n(value.backlog),
    overdue: n(value.overdue),
    unassigned: n(value.unassigned),
  };
}

export async function loadCompanyOperatingPulse({ force = false } = {}) {
  // The routing rollup is deliberately independent from the rest of the
  // decisions board. Re-use a very short, user-scoped session cache on quick
  // returns so the leadership cards paint immediately without leaking one
  // employee's wider scope to another session.
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id || null;
  const cacheKey = userId ? `sa-company-pulse:${userId}` : null;
  if (!force && cacheKey) {
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
      if (cached?.savedAt && Date.now() - cached.savedAt < CACHE_TTL_MS && cached.value) {
        return cached.value;
      }
    } catch { /* ignore a malformed browser cache */ }
  }

  const { data, error } = await supabase.rpc('company_operating_pulse');
  if (error) throw error;

  const value = {
    generatedAt: data?.generated_at || null,
    sales: data?.sales ? {
      ...team(data.sales),
      withoutNextAction: n(data.sales.without_next_action),
      financialHoldConflicts: n(data.sales.financial_hold_conflicts),
      platformOpportunities: n(data.sales.platform_opportunities),
      followups: n(data.sales.followups),
      leads: n(data.sales.leads),
    } : null,
    collections: data?.collections ? {
      ...team(data.collections),
      open: n(data.collections.open),
      openAmount: n(data.collections.open_amount),
      promiseOverdue: n(data.collections.promise_overdue),
      promiseToday: n(data.collections.promise_today),
      snoozeExpired: n(data.collections.snooze_expired),
    } : null,
    support: data?.support ? {
      ...team(data.support),
      open: n(data.support.open),
      withoutFollowup: n(data.support.without_followup),
      urgent: n(data.support.urgent),
      stale3d: n(data.support.stale_3d),
    } : null,
  };
  if (cacheKey) {
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), value })); }
    catch { /* storage disabled/full — live result is still valid */ }
  }
  return value;
}
