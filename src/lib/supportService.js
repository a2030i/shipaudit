// supportService.js — تذاكر خدمة العملاء (§1.35)
// المشكلة: مشاكل العملاء في محادثات هاتف تضيع. الحل: تذكرة برقم مرجعي
// (TKT-0042) + حالة + مسؤول + سجل أحداث. كل تغيير يُسجَّل في
// support_ticket_events — وهو ما سيغذّي إشعارات واتساب مستقبلاً.
import { supabase } from './supabase.js';

// حالات التذكرة — نقطة الحقيقة الواحدة للعرض (المفاتيح تطابق check constraint)
export const TICKET_STATUSES = {
  open:             { label: 'جديدة',          color: '#0EA5E9' },
  in_progress:      { label: 'قيد المعالجة',   color: 'var(--gold)' },
  waiting_customer: { label: 'بانتظار العميل', color: '#8B5CF6' },
  resolved:         { label: 'محلولة',         color: 'var(--green)' },
  closed:           { label: 'مغلقة',          color: 'var(--muted)' },
};
export const OPEN_STATUSES = ['open', 'in_progress', 'waiting_customer'];
export function ticketStatusMeta(k) { return TICKET_STATUSES[k] || { label: k, color: 'var(--muted)' }; }
export function ticketRef(no) { return `TKT-${String(no).padStart(4, '0')}`; }

// إحصائيات رأس اللوحة (RPC — عدّ سيرفري، لا يتأثر بالفلاتر/الترقيم)
export async function loadTicketStats() {
  const { data, error } = await supabase.rpc('support_ticket_stats');
  if (error) throw error;
  return {
    open:       Number(data?.open) || 0,
    inProgress: Number(data?.in_progress) || 0,
    waiting:    Number(data?.waiting) || 0,
    stale3d:    Number(data?.stale3d) || 0,
    resolved7d: Number(data?.resolved7d) || 0,
    total:      Number(data?.total) || 0,
  };
}

const TICKET_SELECT = '*, creator:created_by(name), assignee:assigned_to(name)';

function mapTicket(r) {
  return {
    id: r.id,
    ticketNo: r.ticket_no,
    ref: ticketRef(r.ticket_no),
    storeId: r.store_id,
    storeName: r.store_name,
    customerPhone: r.customer_phone,
    title: r.title,
    description: r.description,
    carrierId: r.carrier_id,
    carrierName: r.carrier_name,
    awb: r.awb,
    status: r.status,
    source: r.source,
    createdBy: r.created_by,
    creatorName: r.creator?.name || null,
    assignedTo: r.assigned_to,
    assigneeName: r.assignee?.name || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at,
  };
}

// قائمة التذاكر مع الفلاتر. قاعدة §6: أي .range() يلزمه .order('id') tiebreaker.
export async function loadTickets({ status = '', carrierId = '', assignedTo = '', q = '', openOnly = false, from = 0, limit = 200 } = {}) {
  let query = supabase.from('support_tickets')
    .select(TICKET_SELECT, { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(from, from + limit - 1);
  if (status) query = query.eq('status', status);
  else if (openOnly) query = query.in('status', OPEN_STATUSES);
  if (carrierId) query = query.eq('carrier_id', carrierId);
  if (assignedTo) query = query.eq('assigned_to', assignedTo);
  const s = q.trim();
  if (s) {
    // بحث حر: المتجر/العنوان/AWB/الهاتف — ولو كان رقم تذكرة (TKT-0042 أو 42) نلتقطه
    const num = parseInt(s.replace(/^tkt-?/i, ''), 10);
    const ors = [`store_name.ilike.%${s}%`, `title.ilike.%${s}%`, `awb.ilike.%${s}%`, `customer_phone.ilike.%${s}%`];
    if (Number.isFinite(num) && num > 0) ors.push(`ticket_no.eq.${num}`);
    query = query.or(ors.join(','));
  }
  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: (data || []).map(mapTicket), count: count ?? 0 };
}

// إنشاء تذكرة + حدث 'create' — يرجع التذكرة برقمها المرجعي
export async function createTicket({ storeId, storeName, customerPhone, title, description, carrierId, carrierName, awb, userId }) {
  const { data, error } = await supabase.from('support_tickets').insert({
    store_id: storeId || null,
    store_name: storeName,
    customer_phone: customerPhone || null,
    title,
    description: description || null,
    carrier_id: carrierId || null,
    carrier_name: carrierName || null,
    awb: awb || null,
    created_by: userId || null,
  }).select(TICKET_SELECT).single();
  if (error) throw error;
  await supabase.from('support_ticket_events').insert({
    ticket_id: data.id, user_id: userId || null, kind: 'create', new_status: 'open',
  });
  return mapTicket(data);
}

// تغيير الحالة (+ resolved_at عند الحل/الإغلاق) وتسجيل الحدث
export async function updateTicketStatus(ticketId, { newStatus, oldStatus, userId, note = null }) {
  const patch = { status: newStatus };
  patch.resolved_at = (newStatus === 'resolved' || newStatus === 'closed') ? new Date().toISOString() : null;
  const { data, error } = await supabase.from('support_tickets')
    .update(patch).eq('id', ticketId).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('لم يُحدَّث أي صف (تحقّق من الصلاحيات)');
  await supabase.from('support_ticket_events').insert({
    ticket_id: ticketId, user_id: userId || null, kind: 'status',
    old_status: oldStatus || null, new_status: newStatus, note,
  });
}

// إسناد التذكرة لموظف
export async function assignTicket(ticketId, { assigneeId, assigneeName, userId }) {
  const { data, error } = await supabase.from('support_tickets')
    .update({ assigned_to: assigneeId || null }).eq('id', ticketId).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('لم يُحدَّث أي صف (تحقّق من الصلاحيات)');
  await supabase.from('support_ticket_events').insert({
    ticket_id: ticketId, user_id: userId || null, kind: 'assign',
    note: assigneeName ? `أُسندت إلى ${assigneeName}` : 'أُلغي الإسناد',
  });
}

// تعليق على التذكرة
export async function addTicketComment(ticketId, { note, userId }) {
  const { error } = await supabase.from('support_ticket_events').insert({
    ticket_id: ticketId, user_id: userId || null, kind: 'comment', note,
  });
  if (error) throw error;
}

// سجل أحداث تذكرة (للدرج)
export async function loadTicketEvents(ticketId) {
  const { data, error } = await supabase.from('support_ticket_events')
    .select('*, user:user_id(name)')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(e => ({
    id: e.id, kind: e.kind, oldStatus: e.old_status, newStatus: e.new_status,
    note: e.note, userName: e.user?.name || '—', createdAt: e.created_at,
  }));
}

// حذف تذكرة (admin) — قاعدة §6: .select('id') ضد RLS silent-fail
export async function deleteTicket(ticketId) {
  const { data, error } = await supabase.from('support_tickets')
    .delete().eq('id', ticketId).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('لم يُحذف أي صف (تحقّق من الصلاحيات)');
}
