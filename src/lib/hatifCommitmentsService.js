import { supabase } from './supabase.js';

export const HATIF_COMMITMENT_META = {
  pending:            { label: 'موعد قادم', color: 'var(--blue)' },
  needs_confirmation: { label: 'يحتاج تأكيد الموعد', color: 'var(--gold)' },
  on_time_answered:   { label: 'تم الاتصال والرد في الموعد', color: 'var(--green)' },
  on_time_no_answer:  { label: 'حاول في الموعد — لم يرد العميل', color: 'var(--accent3)' },
  late_answered:      { label: 'تم الاتصال متأخراً', color: 'var(--gold)' },
  late_no_answer:     { label: 'حاول متأخراً — لم يرد العميل', color: 'var(--gold)' },
  missed:             { label: 'لم يتم الاتصال', color: 'var(--red)' },
  cancelled:          { label: 'ملغى', color: 'var(--muted)' },
};

export async function loadHatifCallCommitments({ days = 45, limit = 300 } = {}) {
  const since = new Date(Date.now() - Math.max(1, days) * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('hatif_call_commitments')
    .select('id, source_call_id, phone, source_call_at, expected_agent_id, expected_agent_name, window_start, window_end, extraction_confidence, source_text, status, matched_call_id, actual_agent_id, actual_agent_name, attempted_at, answered_at, owner_match, evaluated_at')
    .gte('source_call_at', since)
    .order('window_start', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export function hatifCommitmentMeta(row, now = Date.now()) {
  if (row?.status === 'pending' && row.window_end && new Date(row.window_end).getTime() < now) {
    return { label: 'انتهى الموعد — بانتظار مزامنة هاتف', color: 'var(--gold)' };
  }
  return HATIF_COMMITMENT_META[row?.status] || { label: row?.status || '—', color: 'var(--muted)' };
}

export function summarizeHatifCommitments(rows, now = Date.now()) {
  const result = { upcoming: 0, dueToday: 0, onTime: 0, attemptedNoAnswer: 0, breached: 0, review: 0 };
  const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
  for (const row of rows || []) {
    if (row.status === 'needs_confirmation') { result.review++; continue; }
    if (row.status === 'pending') {
      result.upcoming++;
      if (row.window_start && new Date(row.window_start).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }) === today) result.dueToday++;
    }
    if (row.status === 'on_time_answered') result.onTime++;
    if (row.status === 'on_time_no_answer') result.attemptedNoAnswer++;
    if (['late_answered', 'late_no_answer', 'missed'].includes(row.status)) result.breached++;
  }
  return result;
}
