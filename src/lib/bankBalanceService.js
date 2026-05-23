// Bank balance tracking — manual ledger entry.
//
// The operator opens /overview, sees the cash position, and clicks
// "تحديث رصيد البنك" to enter the current bank balance whenever
// they check their account. Each update appends a new row to
// bank_balance_log so we get a history sparkline + audit trail.
//
// Public API:
//   loadCurrentBalance()  → { balance, recordedAt, notes, ... } | null
//   setBalance({ balance, notes, userId })
//   listHistory({ limit })
//
// Intentionally minimal — no bank-API integration, no statement
// parsing. Just a manual entry the operator owns.

import { supabase } from './supabase.js';

export async function loadCurrentBalance() {
  const { data, error } = await supabase
    .from('bank_balance_log')
    .select('*')
    .order('recorded_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const r = data?.[0];
  if (!r) return null;
  return {
    balance:    Number(r.balance) || 0,
    notes:      r.notes,
    recordedAt: r.recorded_at,
  };
}

export async function setBalance({ balance, notes = null, userId = null }) {
  const n = Number(balance);
  if (!Number.isFinite(n)) throw new Error('قيمة الرصيد غير صالحة');
  const { data, error } = await supabase
    .from('bank_balance_log')
    .insert({
      balance:      n,
      notes:        notes?.trim() || null,
      recorded_by:  userId || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listBalanceHistory({ limit = 30 } = {}) {
  const { data, error } = await supabase
    .from('bank_balance_log')
    .select('*')
    .order('recorded_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(r => ({
    id:         r.id,
    balance:    Number(r.balance) || 0,
    notes:      r.notes,
    recordedAt: r.recorded_at,
    recordedBy: r.recorded_by,
  }));
}
