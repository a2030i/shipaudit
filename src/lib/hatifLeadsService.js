// فرص من هاتف — أرقام تحدّثت معنا في واتساب لكنها ليست في كشف متاجرنا.
// المصدر: جدول hatif_unknown_contacts (تملؤه دالة hatif-contacts-sync action=audit).
// named_manually = سمّاه موظف (الاسم يحوي حرفاً) = إشارة اهتمام حقيقية → الأثمن.
//
// توحيد المتابعة (§1.32 تكملة): الحالة/الملاحظة/الإسناد تعيش في
// retargeting_followups الموحّد (نفس مفردات إعادة الاستهداف ونفس سجل التغييرات)
// — hatif_unknown_contacts صار مصدر «مَن هم» فقط لا «أين وصلنا معهم».
import { supabase } from './supabase.js';

export const LEAD_KINDS = {
  mobile_sa:   { label: 'جوال سعودي',   color: 'var(--green)' },
  service_sa:  { label: 'موحّد/مجاني',  color: '#8B5CF6' },
  landline_sa: { label: 'ثابت سعودي',   color: '#0EA5E9' },
  foreign:     { label: 'أجنبي',        color: 'var(--muted)' },
  other:       { label: 'آخر',          color: 'var(--muted2)' },
};
export const kindMeta = (k) => LEAD_KINDS[k] || { label: k || '—', color: 'var(--muted)' };

// كل المتابعات (جدول صغير — بضعة آلاف كحد أقصى) → Map بالهاتف.
// §6: أي range يحتاج order ثابتاً؛ PostgREST يسقّف 1000 فنجلب على صفحات.
export async function loadFollowupsMap() {
  const map = new Map();
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await supabase.from('retargeting_followups')
      .select('phone, status, owner_id, next_action_at, notes')
      .order('phone', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    for (const r of (data || [])) map.set(r.phone, r);
    if (!data || data.length < 1000) break;
  }
  return map;
}

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
  // دمج حالة المتابعة الموحّدة (retargeting_followups) — لا من hatif_unknown_contacts
  const fu = await loadFollowupsMap();
  return rows.map(r => {
    const f = fu.get(r.phone);
    return {
      phone: r.phone, contactId: r.contact_id, name: r.name, company: r.company,
      namedManually: !!r.named_manually, kind: r.phone_kind,
      createdAt: r.created_at_hatif, lastSeen: r.last_seen,
      status: f?.status || 'new',
      ownerId: f?.owner_id || null,
      note: f?.notes || null,
      nextActionAt: f?.next_action_at || null,
    };
  });
}

// مزامنة فورية: تجرد جهات هاتف وتلتقط أي جوال سعودي جديد كلّمنا وليس عميلاً.
// (cron يفعلها كل ساعتين أيضاً — هذا للفوري عند الطلب.)
export async function syncHatifLeads() {
  const { data, error } = await supabase.functions.invoke('hatif-contacts-sync', {
    body: { action: 'audit', all: true, save: true },
  });
  if (error) return { ok: false, error: error.message };
  return data;
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
