// supportService.js — تذاكر خدمة العملاء (§1.35)
// المشكلة: مشاكل العملاء في محادثات هاتف تضيع. الحل: تذكرة برقم مرجعي
// (TKT-0042) + حالة + مسؤول + سجل أحداث. كل تغيير يُسجَّل في
// support_ticket_events. السجل داخلي ولا يرسل شيئاً إلى هاتف أو العميل.
import { supabase } from './supabase.js';

// حالات التذكرة — نقطة الحقيقة الواحدة للعرض (المفاتيح تطابق check constraint)
export const TICKET_STATUSES = {
  open:             { label: 'جديدة',          color: 'var(--accent3)' },
  in_progress:      { label: 'قيد المعالجة',   color: 'var(--gold)' },
  waiting_customer: { label: 'بانتظار العميل', color: 'var(--accent)' },
  resolved:         { label: 'محلولة',         color: 'var(--green)' },
  closed:           { label: 'مغلقة',          color: 'var(--muted)' },
};
export const OPEN_STATUSES = ['open', 'in_progress', 'waiting_customer'];
export function ticketStatusMeta(k) { return TICKET_STATUSES[k] || { label: k, color: 'var(--muted)' }; }
export function ticketRef(no) { return `TKT-${String(no).padStart(4, '0')}`; }

// أولوية المتابعة الإدارية — لا تحاول استنتاجها من محادثة هاتف.
export const TICKET_PRIORITIES = {
  normal: { label: 'عادية', color: 'var(--accent3)' },
  high:   { label: 'عالية', color: 'var(--gold)' },
  urgent: { label: 'عاجلة', color: 'var(--red)' },
};
export function ticketPriorityMeta(k) { return TICKET_PRIORITIES[k] || TICKET_PRIORITIES.normal; }

// سبب الإغلاق إلزامي كي لا تتحول «مغلقة» إلى طريقة لإخفاء العمل المعلّق.
export const CLOSURE_REASONS = {
  resolved:             'حُلّت المشكلة',
  carrier_confirmed:    'أكّدت شركة الشحن الحل',
  billing_corrected:    'صُحّحت الفاتورة/التسوية',
  customer_informed:    'أُبلغ العميل بالنتيجة النهائية',
  no_customer_response: 'لم يرد العميل بعد المتابعة',
  duplicate:            'مكررة/مرتبطة بتذكرة أخرى',
  rejected_with_reason: 'رُفض الطلب بسبب موثّق',
  other:                'سبب آخر',
};

// أنواع التذكرة — نقطة الحقيقة الواحدة (المفتاح يُخزَّن في support_tickets.category)
export const TICKET_CATEGORIES = {
  delayed:  { label: 'شحنة متأخرة',        icon: '⏰' },
  damaged:  { label: 'شحنة تالفة/مفقودة',  icon: '📦' },
  cod:      { label: 'تحصيل COD',          icon: '💰' },
  billing:  { label: 'فوترة/مالية',        icon: '🧾' },
  platform: { label: 'المنصّة/تقني',       icon: '⚙️' },
  other:    { label: 'أخرى',               icon: '📝' },
};
export function ticketCategoryMeta(k) { return TICKET_CATEGORIES[k] || TICKET_CATEGORIES.other; }

// أنواع الشحنات يلزمها رقم AWB؛ المالي/التقني/أخرى لا يلزمها
export const AWB_REQUIRED_CATEGORIES = ['delayed', 'damaged', 'cod'];

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
    overdue:    Number(data?.overdue) || 0,
    due24h:     Number(data?.due_24h) || 0,
    unassigned: Number(data?.unassigned) || 0,
    noFollowup: Number(data?.without_followup) || 0,
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
    category: r.category || 'other',
    priority: r.priority || 'normal',
    status: r.status,
    source: r.source,
    createdBy: r.created_by,
    creatorName: r.creator?.name || null,
    assignedTo: r.assigned_to,
    assigneeName: r.assignee?.name || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at,
    nextFollowupAt: r.next_followup_at,
    lastFollowupAt: r.last_followup_at,
    closureReason: r.closure_reason,
    resolutionSummary: r.resolution_summary,
  };
}

// قائمة التذاكر مع الفلاتر. قاعدة §6: أي .range() يلزمه .order('id') tiebreaker.
export async function loadTickets({ status = '', carrierId = '', assignedTo = '', category = '', q = '', attention = '', openOnly = false, from = 0, limit = 200 } = {}) {
  let query = supabase.from('support_tickets')
    .select(TICKET_SELECT, { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(from, from + limit - 1);
  if (status) query = query.eq('status', status);
  else if (openOnly) query = query.in('status', OPEN_STATUSES);
  if (carrierId) query = query.eq('carrier_id', carrierId);
  if (assignedTo) query = query.eq('assigned_to', assignedTo);
  if (category) query = category === 'other'
    ? query.or('category.eq.other,category.is.null')
    : query.eq('category', category);
  if (attention === 'overdue') query = query.in('status', OPEN_STATUSES).lt('next_followup_at', new Date().toISOString());
  if (attention === 'due24h') query = query.in('status', OPEN_STATUSES)
    .gte('next_followup_at', new Date().toISOString())
    .lte('next_followup_at', new Date(Date.now() + 86_400_000).toISOString());
  if (attention === 'unassigned') query = query.in('status', OPEN_STATUSES).is('assigned_to', null);
  if (attention === 'without_followup') query = query.in('status', OPEN_STATUSES).is('next_followup_at', null);
  const s = q.trim();
  if (s) {
    // بحث حر: المتجر/العنوان/AWB/الهاتف — ولو كان رقم تذكرة (TKT-0042 أو 42) نلتقطه
    const num = parseInt(s.replace(/^tkt-?/i, ''), 10);
    const ors = [`store_name.ilike.%${s}%`, `title.ilike.%${s}%`, `description.ilike.%${s}%`, `awb.ilike.%${s}%`, `customer_phone.ilike.%${s}%`];
    if (Number.isFinite(num) && num > 0) ors.push(`ticket_no.eq.${num}`);
    query = query.or(ors.join(','));
  }
  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: (data || []).map(mapTicket), count: count ?? 0 };
}

// إنشاء تذكرة — مع ذكاء نفس الشحنة: لو AWB يطابق تذكرة سابقة،
//   • محلولة/مغلقة → **إعادة فتح تلقائية** + إلحاق التفاصيل الجديدة (reopened)
//   • مفتوحة أصلاً → لا تذكرة مكررة؛ تُلحق التفاصيل بها (existing)
// وإلا تُنشأ جديدة (created). يرجع { ticket, created|reopened|existing }.
export async function createTicket({ storeId, storeName, customerPhone, title, description, carrierId, carrierName, awb, category, priority = 'normal', nextFollowupAt = null, assignedTo, assigneeName, userId }) {
  // العنوان أُلغي من النموذج (قرار المستخدم 2026-07-16) — النوع + الوصف يكفيان.
  // عمود title باقٍ (not null) فيتولّد من تسمية النوع إن لم يُمرَّر.
  const effTitle = (title || '').trim() || ticketCategoryMeta(category || 'other').label;
  const awbNorm = (awb || '').trim();
  if (awbNorm) {
    const { data: dups, error: dupErr } = await supabase.from('support_tickets')
      .select(TICKET_SELECT)
      .ilike('awb', awbNorm)
      .order('created_at', { ascending: false })
      .limit(1);
    if (dupErr) throw dupErr;
    const dup = dups?.[0];
    if (dup) {
      const detail = `مشكلة جديدة على نفس الشحنة (${effTitle})${description ? `: ${description}` : ''}`;
      if (dup.status === 'resolved' || dup.status === 'closed') {
        const { error: upErr } = await supabase.from('support_tickets')
          .update({
            status: 'open', resolved_at: null, closure_reason: null, resolution_summary: null,
            priority, next_followup_at: nextFollowupAt || null,
            assigned_to: dup.assigned_to || assignedTo || null,
          }).eq('id', dup.id);
        if (upErr) throw upErr;
        await supabase.from('support_ticket_events').insert([
          { ticket_id: dup.id, user_id: userId || null, kind: 'status', old_status: dup.status, new_status: 'open',
            note: 'أُعيد فتحها تلقائياً — وردت مشكلة جديدة لنفس رقم الشحنة', internal: true },
          { ticket_id: dup.id, user_id: userId || null, kind: 'comment', note: detail, internal: true },
        ]);
        return { ticket: { ...mapTicket(dup), status: 'open', resolvedAt: null }, reopened: true };
      }
      // مفتوحة أصلاً → إلحاق بدل التكرار
      await supabase.from('support_ticket_events').insert({
        ticket_id: dup.id, user_id: userId || null, kind: 'comment', note: detail, internal: true,
      });
      if (!dup.assigned_to && assignedTo) {
        await supabase.from('support_tickets').update({ assigned_to: assignedTo }).eq('id', dup.id);
      }
      if (nextFollowupAt && (!dup.next_followup_at || new Date(nextFollowupAt) < new Date(dup.next_followup_at))) {
        await supabase.from('support_tickets').update({ next_followup_at: nextFollowupAt }).eq('id', dup.id);
      }
      return { ticket: mapTicket(dup), existing: true };
    }
  }
  const { data, error } = await supabase.from('support_tickets').insert({
    store_id: storeId || null,
    store_name: storeName,
    customer_phone: customerPhone || null,
    title: effTitle,
    description: description || null,
    carrier_id: carrierId || null,
    carrier_name: carrierName || null,
    awb: awbNorm || null,
    category: category || 'other',
    priority,
    next_followup_at: nextFollowupAt || null,
    assigned_to: assignedTo || null,
    created_by: userId || null,
  }).select(TICKET_SELECT).single();
  if (error) throw error;
  const events = [{ ticket_id: data.id, user_id: userId || null, kind: 'create', new_status: 'open', internal: true }];
  if (assignedTo) events.push({ ticket_id: data.id, user_id: userId || null, kind: 'assign', note: assigneeName ? `أُسندت إلى ${assigneeName}` : 'أُسندت عند الإنشاء', internal: true });
  await supabase.from('support_ticket_events').insert(events);
  return { ticket: mapTicket(data), created: true };
}

// تغيير الحالة (+ resolved_at عند الحل/الإغلاق) وتسجيل الحدث
export async function updateTicketStatus(ticketId, { newStatus, closureReason = null, resolutionSummary = null, note = null }) {
  const { data, error } = await supabase.rpc('support_update_status', {
    p_ticket: ticketId,
    p_status: newStatus,
    p_closure_reason: closureReason || null,
    p_resolution_summary: resolutionSummary || null,
    p_note: note || null,
  });
  if (error) throw error;
  return data;
}

// إسناد التذكرة لموظف
export async function assignTicket(ticketId, { assigneeId }) {
  const { data, error } = await supabase.rpc('support_assign_ticket', {
    p_ticket: ticketId, p_assignee: assigneeId || null,
  });
  if (error) throw error;
  return data;
}

// تسجيل موعد المتابعة والأولوية في خطوة واحدة مع حدث تدقيق ذري.
export async function updateTicketFollowup(ticketId, { priority = 'normal', nextFollowupAt = null, note = null }) {
  const { data, error } = await supabase.rpc('support_update_followup', {
    p_ticket: ticketId,
    p_priority: priority,
    p_next: nextFollowupAt || null,
    p_note: note || null,
  });
  if (error) throw error;
  return data;
}

// تحديث مجموعة تذاكر في معاملة واحدة. القاعدة تُسجّل حدثاً لكل تذكرة
// وتمنع الإغلاق الجماعي بلا سبب وخلاصة موحدة.
export async function bulkUpdateTickets(ticketIds, {
  status = null,
  priority = null,
  assigneeMode = 'keep',
  assigneeId = null,
  followupMode = 'keep',
  nextFollowupAt = null,
  closureReason = null,
  resolutionSummary = null,
  note = null,
} = {}) {
  const ids = [...new Set(ticketIds || [])];
  if (!ids.length) throw new Error('اختر تذكرة واحدة على الأقل');
  const { data, error } = await supabase.rpc('support_bulk_update', {
    p_tickets: ids,
    p_status: status || null,
    p_priority: priority || null,
    p_assignee_mode: assigneeMode,
    p_assignee: assigneeId || null,
    p_followup_mode: followupMode,
    p_next: nextFollowupAt || null,
    p_closure_reason: closureReason || null,
    p_resolution_summary: resolutionSummary || null,
    p_note: note || null,
  });
  if (error) throw error;
  return {
    updated: Number(data?.updated) || 0,
    eventKind: data?.event_kind || null,
  };
}

// تعليق على التذكرة. internal=true (الافتراض) = ملاحظة داخلية للفريق فقط —
// القاعدة الدائمة: أي إشعار واتساب مستقبلي يُرسَل فقط للأحداث internal=false.
export async function addTicketComment(ticketId, { note, userId, internal = true }) {
  const { error } = await supabase.from('support_ticket_events').insert({
    ticket_id: ticketId, user_id: userId || null, kind: 'comment', note, internal: !!internal,
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
    note: e.note, internal: e.internal !== false,
    userName: e.user?.name || '—', createdAt: e.created_at,
  }));
}

// داشبورد الأرقام: الحالات × النوع × شركات الشحن + زمن الحل (RPC)
export async function loadSupportDashboard() {
  const { data, error } = await supabase.rpc('support_dashboard');
  if (error) throw error;
  return {
    byStatus: data?.by_status || {},
    byCategory: (data?.by_category || []).map(r => ({ category: r.category, total: Number(r.total) || 0, open: Number(r.open) || 0 })),
    byCarrier: (data?.by_carrier || []).map(r => ({ carrierId: r.carrier_id, carrierName: r.carrier_name || 'بدون شركة', total: Number(r.total) || 0, open: Number(r.open) || 0 })),
    byOwner: (data?.by_owner || []).map(r => ({
      ownerId: r.owner_id, ownerName: r.owner_name || 'بلا مسؤول',
      open: Number(r.open) || 0, overdue: Number(r.overdue) || 0,
      due24h: Number(r.due_24h) || 0, resolved30d: Number(r.resolved_30d) || 0,
      avgResolutionHours: r.avg_resolution_hours == null ? null : Number(r.avg_resolution_hours),
    })),
    byPriority: data?.by_priority || {},
    avgResolutionHours: data?.avg_resolution_hours == null ? null : Number(data.avg_resolution_hours),
    created30d: Number(data?.created_30d) || 0,
    resolved30d: Number(data?.resolved_30d) || 0,
  };
}

// ── المرفقات ──────────────────────────────────────────────────────
// bucket خاص 'support-attachments' — المفتاح ASCII فقط (فخّ §1.7)،
// الاسم العربي يبقى في file_name. كل إرفاق يُسجَّل حدث 'attach'.
const ATT_BUCKET = 'support-attachments';
const asciiKey = (name) => (String(name).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').slice(-80)) || 'file';

export async function uploadTicketAttachments(ticketId, files, userId) {
  const uploaded = [];
  for (const f of files) {
    const path = `t/${ticketId}/${Date.now()}_${asciiKey(f.name)}`;
    const { error: upErr } = await supabase.storage.from(ATT_BUCKET)
      .upload(path, f, { contentType: f.type || undefined });
    if (upErr) throw new Error(`فشل رفع «${f.name}»: ${upErr.message}`);
    const { error } = await supabase.from('support_ticket_attachments').insert({
      ticket_id: ticketId, file_name: f.name, file_path: path,
      size_bytes: f.size || null, mime: f.type || null, uploaded_by: userId || null,
    });
    if (error) throw error;
    await supabase.from('support_ticket_events').insert({
      ticket_id: ticketId, user_id: userId || null, kind: 'attach', note: `📎 ${f.name}`, internal: true,
    });
    uploaded.push(f.name);
  }
  return uploaded;
}

export async function loadTicketAttachments(ticketId) {
  const { data, error } = await supabase.from('support_ticket_attachments')
    .select('*, uploader:uploaded_by(name)')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(a => ({
    id: a.id, fileName: a.file_name, filePath: a.file_path,
    sizeBytes: Number(a.size_bytes) || 0, mime: a.mime,
    uploaderName: a.uploader?.name || '—', createdAt: a.created_at,
  }));
}

// رابط تحميل موقّت (ساعة) — الـbucket خاص فلا روابط دائمة
export async function getAttachmentUrl(filePath) {
  const { data, error } = await supabase.storage.from(ATT_BUCKET).createSignedUrl(filePath, 3600);
  if (error) throw error;
  return data.signedUrl;
}

// حذف تذكرة (admin) — قاعدة §6: .select('id') ضد RLS silent-fail
export async function deleteTicket(ticketId) {
  const { data, error } = await supabase.from('support_tickets')
    .delete().eq('id', ticketId).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('لم يُحذف أي صف (تحقّق من الصلاحيات)');
}
