// فرص من هاتف — أرقام تحدّثت معنا في واتساب لكنها ليست في كشف متاجرنا.
// المصدر: جدول hatif_unknown_contacts (تملؤه دالة hatif-contacts-sync action=audit).
// named_manually = سمّاه موظف (الاسم يحوي حرفاً) = إشارة اهتمام حقيقية → الأثمن.
import { supabase } from './supabase.js';

export const LEAD_STATUSES = {
  new:       { label: 'جديد',        color: '#3B82F6' },
  lead:      { label: 'عميل محتمل',  color: 'var(--green)' },
  supplier:  { label: 'مورد/شريك',   color: '#8B5CF6' },
  noise:     { label: 'ضجيج',        color: 'var(--muted)' },
  converted: { label: 'تحوّل لعميل',  color: 'var(--gold)' },
};
export const LEAD_KINDS = {
  mobile_sa:   { label: 'جوال سعودي',   color: 'var(--green)' },
  service_sa:  { label: 'موحّد/مجاني',  color: '#8B5CF6' },
  landline_sa: { label: 'ثابت سعودي',   color: '#0EA5E9' },
  foreign:     { label: 'أجنبي',        color: 'var(--muted)' },
  other:       { label: 'آخر',          color: 'var(--muted2)' },
};
export const statusMeta = (s) => LEAD_STATUSES[s] || { label: s || '—', color: 'var(--muted)' };
export const kindMeta   = (k) => LEAD_KINDS[k]   || { label: k || '—', color: 'var(--muted)' };

// ⚠️ PostgREST يسقّف عند 1000 صف — نجلب على صفحات (§6: أي range يحتاج order ثابتاً).
export async function loadHatifLeads() {
  const rows = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await supabase.from('hatif_unknown_contacts')
      .select('phone, contact_id, name, company, named_manually, phone_kind, created_at_hatif, status, owner_id, note, last_seen')
      .order('phone', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows.map(r => ({
    phone: r.phone, contactId: r.contact_id, name: r.name, company: r.company,
    namedManually: !!r.named_manually, kind: r.phone_kind,
    createdAt: r.created_at_hatif, status: r.status || 'new',
    ownerId: r.owner_id, note: r.note, lastSeen: r.last_seen,
  }));
}

// تحديث تصنيف/ملاحظة/إسناد فرصة (RLS: authenticated update)
export async function updateHatifLead(phone, { status, note, ownerId } = {}) {
  const patch = { updated_at: new Date().toISOString() };
  if (status !== undefined) patch.status = status;
  if (note !== undefined) patch.note = note;
  if (ownerId !== undefined) patch.owner_id = ownerId || null;
  const { data, error } = await supabase.from('hatif_unknown_contacts')
    .update(patch).eq('phone', phone).select('phone');
  if (error) throw error;
  if (!data?.length) throw new Error('لم يُحدَّث أي صف');   // حماية من فشل RLS الصامت (§6)
  return true;
}

// مؤشّرات سريعة من القائمة المحمَّلة (بلا استدعاء إضافي)
export function computeLeadStats(rows) {
  const s = { total: rows.length, named: 0, mobile: 0, byStatus: {}, byKind: {} };
  for (const r of rows) {
    if (r.namedManually) s.named++;
    if (r.kind === 'mobile_sa') s.mobile++;
    s.byStatus[r.status] = (s.byStatus[r.status] || 0) + 1;
    s.byKind[r.kind] = (s.byKind[r.kind] || 0) + 1;
  }
  return s;
}
