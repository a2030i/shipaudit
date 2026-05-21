// Period closing service.
//
// Month-end period closing is the foundation every reproducible
// financial report rests on. Once a month is closed, the DB triggers
// in the accounting_period_close migration block all inserts /
// updates / deletes against carrier_operations, cod_settlement,
// audits, and payments dated inside that month — the JS layer here
// provides the operator-facing API plus a friendly client-side check
// so the UI can prevent the round-trip when the operator is about to
// hit the trigger.
//
// API:
//   listPeriods()                    → all known close rows
//   getMonthsWithActivity()          → derived YYYY-MM list of months
//                                       that have any data + per-table
//                                       row counts. Drives the "close
//                                       month" picker.
//   closePeriod({ period, note })
//   reopenPeriod({ period, note })
//   isClosed(date | YYYY-MM)         → boolean, hits the cache
//   refreshClosedSet()               → refetch closed periods
//
// The closed-set is cached in module scope after the first refresh
// so isClosed() is synchronous from every caller. Mutations refresh
// it explicitly.

import { supabase } from './supabase.js';

let _closedSet = null;        // Set<'YYYY-MM'>
let _closedLoading = null;    // in-flight promise dedupe

export function periodOf(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return null;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

export async function refreshClosedSet() {
  if (_closedLoading) return _closedLoading;
  _closedLoading = (async () => {
    const { data, error } = await supabase
      .from('period_closes')
      .select('period, status')
      .eq('status', 'closed');
    _closedLoading = null;
    if (error) throw error;
    _closedSet = new Set((data || []).map(r => r.period));
    return _closedSet;
  })();
  return _closedLoading;
}

// Synchronous check. Returns false if the cache isn't loaded yet —
// callers that need certainty should await refreshClosedSet() first
// (the UI in mutation paths does this).
export function isClosed(periodOrDate) {
  if (!_closedSet) return false;
  const p = typeof periodOrDate === 'string' && /^\d{4}-\d{2}$/.test(periodOrDate)
    ? periodOrDate
    : periodOf(periodOrDate);
  return p ? _closedSet.has(p) : false;
}

export async function listPeriods() {
  const { data, error } = await supabase
    .from('period_closes')
    .select('*')
    .order('period', { ascending: false });
  if (error) throw error;
  return data || [];
}

// One row per month that has any financial activity, even months
// not yet recorded in period_closes. The UI uses this to populate
// the "close a month" picker without forcing the operator to type
// in a YYYY-MM string. Counts let them see what they're about to
// lock before they lock it.
export async function getMonthsWithActivity() {
  const { data, error } = await supabase.rpc('months_with_activity');
  if (error) throw error;
  return data || [];
}

export async function closePeriod({ period, note = null, userId = null }) {
  if (!/^\d{4}-\d{2}$/.test(period || '')) throw new Error('صيغة الفترة يجب أن تكون YYYY-MM');
  const { data, error } = await supabase
    .from('period_closes')
    .upsert({
      period,
      status:      'closed',
      closed_at:   new Date().toISOString(),
      closed_by:   userId,
      closed_note: note?.trim() || null,
      // Clear reopened_* so the row reflects its current state cleanly
      reopened_at:   null,
      reopened_by:   null,
      reopened_note: null,
      updated_at:    new Date().toISOString(),
    }, { onConflict: 'period' })
    .select()
    .single();
  if (error) throw error;
  await refreshClosedSet();
  return data;
}

export async function reopenPeriod({ period, note = null, userId = null }) {
  if (!/^\d{4}-\d{2}$/.test(period || '')) throw new Error('صيغة الفترة يجب أن تكون YYYY-MM');
  const { data, error } = await supabase
    .from('period_closes')
    .update({
      status:        'open',
      reopened_at:   new Date().toISOString(),
      reopened_by:   userId,
      reopened_note: note?.trim() || null,
      updated_at:    new Date().toISOString(),
    })
    .eq('period', period)
    .select()
    .single();
  if (error) throw error;
  await refreshClosedSet();
  return data;
}
