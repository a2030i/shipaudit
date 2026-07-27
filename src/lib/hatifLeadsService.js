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
  service_sa:  { label: 'موحّد/مجاني',  color: 'var(--accent)' },
  landline_sa: { label: 'ثابت سعودي',   color: 'var(--accent3)' },
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

// «فرص هاتف» مُثراة عبر RPC hatif_leads_enriched — تربط كل رقم مجهول بأفضل مطابقة
// في crm_leads (اسم/منصّة/قسم/مدينة) + حالة المتابعة الموحّدة. فالـ466 lead نعرفها
// تكتسب هويتها بدل «مجهول». ⚠️ RPC يسقّفه PostgREST عند 1000 (§1.34) → نصفّح
// بـrange (الـRPC فيه ORDER BY phone ثابت).
export async function loadHatifLeads() {
  const rows = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await supabase.rpc('hatif_leads_enriched').range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows.map(r => ({
    phone: r.phone, contactId: r.contact_id,
    hatifName: r.hatif_name,
    // أفضل اسم معروف: اسم الـlead المطابق ثم اسم هاتف (سمّاه الفريق) ثم لا شيء
    name: r.lead_name || r.hatif_name || null,
    company: null,
    // إثراء crm_leads
    leadId: r.lead_id, leadName: r.lead_name, leadMatched: !!r.lead_matched,
    platform: r.platform, category: r.category, city: r.city,
    // معروف = مطابق lead أو مسمّى في هاتف
    identified: !!r.lead_matched || !!r.hatif_name,
    namedManually: !!r.named_manually, kind: r.phone_kind,
    createdAt: r.created_at_hatif, lastSeen: r.last_seen,
    status: r.status || 'new',
    ownerId: r.owner_id || null,
    note: r.note || null,
    nextActionAt: r.next_action_at || null,
  }));
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
  const s = { total: rows.length, named: 0, mobile: 0, identified: 0, leadMatched: 0, byStatus: {}, byKind: {} };
  for (const r of rows) {
    if (r.namedManually) s.named++;
    if (r.kind === 'mobile_sa') s.mobile++;
    if (r.identified) s.identified++;      // مطابق lead أو مسمّى في هاتف
    if (r.leadMatched) s.leadMatched++;    // مطابق crm_leads تحديداً
    s.byStatus[r.status] = (s.byStatus[r.status] || 0) + 1;
    s.byKind[r.kind] = (s.byKind[r.kind] || 0) + 1;
  }
  return s;
}
