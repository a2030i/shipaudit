// سجل المطالبات — follow-through on every overcharge the audit finds.
// Lifecycle: open → submitted → recovered | waived. The register answers
// «كم اكتشفنا؟ كم قيد المطالبة؟ كم استردّينا فعلاً؟» per carrier.

import { supabase } from './supabase.js';

export const CLAIM_STATUS = {
  open:      { label: 'مكتشفة',        color: '#D97706' },
  submitted: { label: 'قيد المطالبة',  color: 'var(--brand)' },
  recovered: { label: 'استُردت',       color: '#059669' },
  waived:    { label: 'تنازل عنها',    color: '#6B7280' },
};

export async function loadClaims() {
  const { data, error } = await supabase
    .from('audit_claims').select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createClaim({ carrierId, source = 'manual', reference, title, amount, notes, userId }) {
  const { data, error } = await supabase.from('audit_claims').insert({
    carrier_id: carrierId, source, reference: reference || null,
    title, amount: +Number(amount || 0).toFixed(2),
    notes: notes || null, created_by: userId || null,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function updateClaim(id, patch) {
  const upd = { ...patch, updated_at: new Date().toISOString() };
  if (patch.status === 'recovered' || patch.status === 'waived') {
    upd.resolved_at = new Date().toISOString();
  }
  const { error } = await supabase.from('audit_claims').update(upd).eq('id', id);
  if (error) throw error;
}

export async function deleteClaim(id) {
  const { data, error } = await supabase
    .from('audit_claims').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('لم يُحذف شيء (صلاحيات؟)');
}

export function summarizeClaims(claims) {
  const s = { open: 0, submitted: 0, recovered: 0, waived: 0,
              openTotal: 0, submittedTotal: 0, recoveredTotal: 0 };
  for (const c of claims) {
    s[c.status] = (s[c.status] || 0) + 1;
    if (c.status === 'open')      s.openTotal      += Number(c.amount) || 0;
    if (c.status === 'submitted') s.submittedTotal += Number(c.amount) || 0;
    if (c.status === 'recovered') s.recoveredTotal += Number(c.recovered_amount ?? c.amount) || 0;
  }
  s.openTotal = +s.openTotal.toFixed(2);
  s.submittedTotal = +s.submittedTotal.toFixed(2);
  s.recoveredTotal = +s.recoveredTotal.toFixed(2);
  return s;
}
