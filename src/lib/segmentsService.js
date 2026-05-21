// Saved customer-segments service.
//
// Backs the chip strip at the top of /segments — each row is a named
// filter preset the operator built. Counts are NOT stored here: the
// /segments page recomputes them client-side by re-running each row's
// filter predicate against the in-memory snapshot. That keeps the
// table tiny and the "refresh all" flow a single data fetch instead
// of one query per chip.
//
// Public API:
//   listSegments()                                 → row[]
//   createSegment({ name, filters, color, userId }) → row
//   updateSegment(id, { name?, filters?, color? }) → row
//   deleteSegment(id)                              → { ok: true }

import { supabase } from './supabase.js';

export async function listSegments() {
  const { data, error } = await supabase
    .from('customer_segments')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createSegment({ name, filters, color = null, userId = null }) {
  if (!name?.trim()) throw new Error('الاسم مطلوب');
  const { data, error } = await supabase
    .from('customer_segments')
    .insert({
      name:       name.trim(),
      filters:    filters || {},
      color,
      created_by: userId,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateSegment(id, patch) {
  if (!id) throw new Error('id مطلوب');
  const row = { updated_at: new Date().toISOString() };
  if (patch.name    !== undefined) row.name    = patch.name.trim();
  if (patch.filters !== undefined) row.filters = patch.filters;
  if (patch.color   !== undefined) row.color   = patch.color;
  const { data, error } = await supabase
    .from('customer_segments')
    .update(row)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteSegment(id) {
  if (!id) throw new Error('id مطلوب');
  const { error, data } = await supabase
    .from('customer_segments')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('لم يتم الحذف');
  return { ok: true };
}
