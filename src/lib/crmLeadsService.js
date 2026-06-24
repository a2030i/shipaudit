// crmLeadsService.js — الجهات/المتاجر الخارجية (leads) للتواصل والمبيعات.
//
// يحاكي نمط snapshot المتاجر (merchantsService): الصفحة تقرأ الـxlsx →
// تمرّر allRows هنا → parseLeadsRows → uploadLeadsSnapshot (مع كشف تكرار
// عبر normalizeName + تخطّي العملاء الموجودين سلفاً). التحويل لعميل يضع
// أثراً (converted_*) بلا تكرار صف receivables.

import { supabase } from './supabase.js';
import { normalizeName } from './crmService.js';

function toPhoneString(v) {
  if (v == null) return null;
  if (typeof v === 'number') return String(Math.round(v)); // حماية 12-رقم من scientific notation
  const s = String(v).trim();
  return s || null;
}

// مفاتيح أعمدة مرنة (عربي/إنجليزي)
const HEADER_KEYS = {
  name:     ['الاسم', 'اسم المتجر', 'المتجر', 'الجهة', 'name', 'store', 'store name', 'merchant'],
  phone:    ['الجوال', 'الهاتف', 'رقم الجوال', 'phone', 'mobile', 'tel'],
  whatsapp: ['واتساب', 'whatsapp', 'wa'],
  email:    ['الايميل', 'البريد', 'email', 'e-mail'],
  city:     ['المدينة', 'city'],
  notes:    ['ملاحظات', 'notes', 'note'],
};

function findIdx(header, keys) {
  const norm = header.map(h => String(h || '').toLowerCase().trim());
  for (const k of keys) {
    const i = norm.findIndex(h => h === k.toLowerCase() || h.includes(k.toLowerCase()));
    if (i >= 0) return i;
  }
  return -1;
}

export function parseLeadsRows(allRows) {
  if (!Array.isArray(allRows) || allRows.length < 2) throw new Error('الملف فارغ أو غير معتاد');
  const header = allRows[0];
  const cols = {};
  for (const [f, keys] of Object.entries(HEADER_KEYS)) cols[f] = findIdx(header, keys);
  if (cols.name < 0) throw new Error('لم يُعثر على عمود الاسم/المتجر');
  const out = [];
  for (let i = 1; i < allRows.length; i++) {
    const r = allRows[i]; if (!r) continue;
    const name = String(r[cols.name] ?? '').trim();
    if (!name) continue;
    out.push({
      name,
      phone:    cols.phone    >= 0 ? toPhoneString(r[cols.phone])    : null,
      whatsapp: cols.whatsapp >= 0 ? toPhoneString(r[cols.whatsapp]) : null,
      email:    cols.email    >= 0 ? String(r[cols.email] ?? '').trim() || null : null,
      city:     cols.city     >= 0 ? String(r[cols.city] ?? '').trim() || null : null,
      notes:    cols.notes    >= 0 ? String(r[cols.notes] ?? '').trim() || null : null,
    });
  }
  return out;
}

// رفع snapshot — يكشف التكرار (داخل الرفعة + مقابل leads موجودة) ويتخطّى
// المتاجر التي هي أصلاً عملاء (تطابق الاسم المطبّع مع customer_receivables).
export async function uploadLeadsSnapshot({ rows, userId = null, existingCustomerNames = [] } = {}) {
  if (!Array.isArray(rows) || !rows.length) return { added: 0, skipped: 0 };
  const snapshotId = `lead_${Date.now()}`;
  const custNorm = new Set((existingCustomerNames || []).map(normalizeName));

  // leads موجودة بالفعل (لتفادي التكرار عبر الرفعات)
  const { data: existing } = await supabase.from('crm_leads').select('name_normalized');
  const seen = new Set((existing || []).map(r => r.name_normalized));

  const toInsert = []; let skipped = 0;
  for (const r of rows) {
    const norm = normalizeName(r.name);
    if (!norm) { skipped++; continue; }
    if (seen.has(norm) || custNorm.has(norm)) { skipped++; continue; } // مكرّر أو عميل موجود
    seen.add(norm);
    toInsert.push({
      name: r.name, name_normalized: norm, phone: r.phone, whatsapp: r.whatsapp,
      email: r.email, city: r.city, notes: r.notes,
      source: 'upload', snapshot_id: snapshotId, status: 'new',
      created_by: userId,
    });
  }
  let added = 0;
  for (let i = 0; i < toInsert.length; i += 200) {
    const chunk = toInsert.slice(i, i + 200);
    const { error } = await supabase.from('crm_leads').insert(chunk);
    if (!error) added += chunk.length;
  }
  return { added, skipped, snapshotId };
}

export async function loadLeads({ status = null, ownerId = null } = {}) {
  let q = supabase.from('crm_leads').select('*').order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  if (ownerId) q = q.eq('owner_id', ownerId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function createLead({ name, phone = null, whatsapp = null, email = null, city = null, notes = null, ownerId = null, userId = null }) {
  if (!name?.trim()) throw new Error('الاسم مطلوب');
  const { data, error } = await supabase.from('crm_leads').insert({
    name: name.trim(), name_normalized: normalizeName(name), phone, whatsapp, email, city, notes,
    source: 'manual', status: 'new', owner_id: ownerId, created_by: userId,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function updateLead(id, patch) {
  if (!id) throw new Error('id مطلوب');
  const { data, error } = await supabase.from('crm_leads')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function updateLeadStatus(id, status) {
  return updateLead(id, { status });
}

// تحويل جهة → عميل: أثر بلا تكرار (converted_*). إن طوبق متجر/عميل نمرّره.
export async function convertLead(id, { customerName = null, storeId = null } = {}) {
  if (!id) throw new Error('id مطلوب');
  return updateLead(id, {
    status: 'converted', converted_at: new Date().toISOString(),
    converted_customer: customerName, converted_store_id: storeId,
  });
}

export async function deleteLead(id) {
  if (!id) throw new Error('id مطلوب');
  const { error } = await supabase.from('crm_leads').delete().eq('id', id);
  if (error) throw error;
  return { ok: true };
}
