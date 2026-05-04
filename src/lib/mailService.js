import { supabase } from './supabase.js';

// ── Profiles ──────────────────────────────────────────────────────────────────
export async function getAllProfiles() {
  const { data } = await supabase.from('profiles').select('*').order('role');
  return data ?? [];
}

export async function getProfileByRole(role) {
  const { data } = await supabase.from('profiles').select('*').eq('role', role).single();
  return data ?? null;
}

export async function updateProfile(id, updates) {
  const { data, error } = await supabase.from('profiles').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// ── Tasks ─────────────────────────────────────────────────────────────────────
export async function getTasks(profile, {
  page          = 0,
  pageSize      = 100,
  attachFilter  = 'all',
  search        = '',
  priority      = 'all',
  dateFrom      = '',
  dateTo        = '',
  assignedTo    = 'all',
  isFinancial   = 'all',
  sortBy        = 'date_desc',
  hideCompleted = false,
  readFilter    = 'all',   // 'all' | 'unread' | 'read'
  source        = 'all',   // 'all' | 'gmail' | 'manual'
  senderEmails  = [],      // filter by one or more email addresses
  viewedFilter  = 'all',   // 'all' | 'viewed' | 'not_viewed'
} = {}) {
  const start = page * pageSize;

  const applySort = (q) => {
    if (sortBy === 'date_asc')      return q.order('email_date', { ascending: true,  nullsLast: true });
    if (sortBy === 'priority_desc') return q.order('priority',   { ascending: false, nullsLast: true })
                                             .order('email_date', { ascending: false, nullsLast: true });
    return q.order('email_date', { ascending: false, nullsLast: true }); // date_desc
  };

  let countQ = supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('is_deleted', false);
  let dataQ  = applySort(
    supabase.from('tasks')
      .select(`*, assigned_profile:profiles!tasks_assigned_to_fkey(id,name,role,avatar_color)`)
  ).eq('is_deleted', false).range(start, start + pageSize - 1);

  if (profile.role !== 'admin') {
    countQ = countQ.eq('assigned_to', profile.id);
    dataQ  = dataQ.eq('assigned_to', profile.id);
  }

  // Attachment
  if (attachFilter === 'excel') {
    countQ = countQ.eq('has_excel', true).eq('has_pdf', false);
    dataQ  = dataQ.eq('has_excel', true).eq('has_pdf', false);
  } else if (attachFilter === 'pdf') {
    countQ = countQ.eq('has_pdf', true).eq('has_excel', false);
    dataQ  = dataQ.eq('has_pdf', true).eq('has_excel', false);
  } else if (attachFilter === 'both') {
    countQ = countQ.eq('has_excel', true).eq('has_pdf', true);
    dataQ  = dataQ.eq('has_excel', true).eq('has_pdf', true);
  } else if (attachFilter === 'none') {
    countQ = countQ.eq('has_excel', false).eq('has_pdf', false);
    dataQ  = dataQ.eq('has_excel', false).eq('has_pdf', false);
  }

  // Text search
  if (search.trim()) {
    const q = `%${search.trim()}%`;
    const orFilter = `email_subject.ilike.${q},email_from.ilike.${q},email_from_name.ilike.${q},ai_summary.ilike.${q}`;
    countQ = countQ.or(orFilter);
    dataQ  = dataQ.or(orFilter);
  }

  // Priority
  if (priority !== 'all') {
    countQ = countQ.eq('priority', priority);
    dataQ  = dataQ.eq('priority', priority);
  }

  // Date range
  if (dateFrom) {
    countQ = countQ.gte('email_date', dateFrom);
    dataQ  = dataQ.gte('email_date', dateFrom);
  }
  if (dateTo) {
    const end = dateTo + 'T23:59:59Z';
    countQ = countQ.lte('email_date', end);
    dataQ  = dataQ.lte('email_date', end);
  }

  // Assigned to (admin only)
  if (profile.role === 'admin' && assignedTo !== 'all') {
    if (assignedTo === 'unassigned') {
      countQ = countQ.is('assigned_to', null);
      dataQ  = dataQ.is('assigned_to', null);
    } else {
      countQ = countQ.eq('assigned_to', assignedTo);
      dataQ  = dataQ.eq('assigned_to', assignedTo);
    }
  }

  // Hide completed tasks (for employee default view)
  if (hideCompleted) {
    const done = ['approved', 'rejected', 'not_financial', 'approved_acc1', 'rejected_acc1'];
    countQ = countQ.not('status', 'in', `(${done.join(',')})`);
    dataQ  = dataQ.not('status', 'in', `(${done.join(',')})`);
  }

  // Financial
  if (isFinancial === 'yes') {
    countQ = countQ.eq('ai_is_financial', true);
    dataQ  = dataQ.eq('ai_is_financial', true);
  } else if (isFinancial === 'no') {
    countQ = countQ.eq('ai_is_financial', false);
    dataQ  = dataQ.eq('ai_is_financial', false);
  }

  // Read filter
  if (readFilter === 'unread') {
    countQ = countQ.eq('is_read', false);
    dataQ  = dataQ.eq('is_read', false);
  } else if (readFilter === 'read') {
    countQ = countQ.eq('is_read', true);
    dataQ  = dataQ.eq('is_read', true);
  }

  // Source
  if (source !== 'all') {
    countQ = countQ.eq('source', source);
    dataQ  = dataQ.eq('source', source);
  }

  // Sender (multi)
  if (senderEmails?.length) {
    countQ = countQ.in('email_from', senderEmails);
    dataQ  = dataQ.in('email_from', senderEmails);
  }

  // Viewed filter (admin only)
  if (viewedFilter === 'viewed') {
    countQ = countQ.not('last_viewed_at', 'is', null);
    dataQ  = dataQ.not('last_viewed_at', 'is', null);
  } else if (viewedFilter === 'not_viewed') {
    countQ = countQ.is('last_viewed_at', null);
    dataQ  = dataQ.is('last_viewed_at', null);
  }

  const [{ count }, { data, error }] = await Promise.all([countQ, dataQ]);
  if (error) throw error;
  const tasks = data ?? [];
  return { tasks, hasMore: tasks.length === pageSize, total: count ?? 0 };
}

export async function bulkAssignTasks(taskIds, assigneeId, userId) {
  if (!taskIds.length) return;
  const { data: assigneeProfile } = await supabase.from('profiles').select('role').eq('id', assigneeId).single();
  const newStatus = assigneeProfile?.role === 'accountant2' ? 'pending_acc2' : 'pending_acc1';
  const CHUNK = 50;
  for (let i = 0; i < taskIds.length; i += CHUNK) {
    await supabase.from('tasks')
      .update({ assigned_to: assigneeId, status: newStatus })
      .in('id', taskIds.slice(i, i + CHUNK));
    await supabase.from('task_actions').insert(
      taskIds.slice(i, i + CHUNK).map(id => ({ task_id: id, user_id: userId, action: 'reassigned', notes: 'إسناد جماعي' }))
    );
  }
  await notify(assigneeId, null, `📋 تم إسناد ${taskIds.length} مهمة إليك`, 'إسناد جماعي');
}

// ── Nav permissions (stored in app_settings) ─────────────────────────────────
const NAV_KEY = 'NAV_PERMISSIONS';
const NAV_DEFAULTS = { accountant1: ['mail'], accountant2: ['mail'] };

export async function getNavPermissions() {
  const { data } = await supabase.from('app_settings').select('value').eq('key', NAV_KEY).single();
  try { return data ? JSON.parse(data.value) : NAV_DEFAULTS; } catch { return NAV_DEFAULTS; }
}

export async function saveNavPermissions(perms) {
  await supabase.from('app_settings')
    .upsert({ key: NAV_KEY, value: JSON.stringify(perms) }, { onConflict: 'key' });
}

export async function getTaskById(id) {
  const { data, error } = await supabase
    .from('tasks')
    .select(`
      *,
      assigned_profile:profiles!tasks_assigned_to_fkey(id,name,role,avatar_color),
      attachments(*),
      task_actions(*, user:profiles(id,name,role,avatar_color))
    `)
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function createTask(taskData, attachments, creatorId) {
  const { data: task, error } = await supabase
    .from('tasks')
    .insert({ ...taskData, created_by: creatorId })
    .select()
    .single();
  if (error) throw error;

  if (attachments?.length) {
    await supabase.from('attachments').insert(
      attachments.map(a => ({ ...a, task_id: task.id }))
    );
  }

  await supabase.from('task_actions').insert({
    task_id: task.id, user_id: creatorId, action: 'created',
    notes: `تم إنشاء المهمة من الإيميل: ${task.email_subject}`,
  });

  return task;
}

// ── Workflow: Approve / Reject ─────────────────────────────────────────────────
export async function approveTask(task, userId, notes = '') {
  const acc2 = await getProfileByRole('accountant2');
  let newStatus = 'approved';
  let newAssignedTo = null;

  if (task.status === 'pending_acc1' && task.has_pdf && acc2) {
    newStatus    = 'pending_acc2';
    newAssignedTo = acc2.id;
    await notify(acc2.id, task.id, '📋 مهمة جديدة تحتاج موافقتك',
      `${task.email_subject} — بانتظار مراجعة PDF`);
  } else if (task.status === 'pending_acc1') {
    newStatus = 'approved';
  } else if (task.status === 'pending_acc2') {
    newStatus = 'approved';
    // notify admin
    const admin = await getProfileByRole('admin');
    if (admin) await notify(admin.id, task.id, '✅ تمت الموافقة الكاملة', task.email_subject);
  }

  const updates = { status: newStatus };
  if (newAssignedTo) updates.assigned_to = newAssignedTo;

  await supabase.from('tasks').update(updates).eq('id', task.id);
  await supabase.from('task_actions').insert({ task_id: task.id, user_id: userId, action: 'approved', notes });
}

export async function rejectTask(taskId, userId, notes = '') {
  await supabase.from('tasks').update({ status: 'rejected' }).eq('id', taskId);
  await supabase.from('task_actions').insert({ task_id: taskId, user_id: userId, action: 'rejected', notes });

  const admin = await getProfileByRole('admin');
  if (admin) {
    const task = await supabase.from('tasks').select('email_subject').eq('id', taskId).single();
    await notify(admin.id, taskId, '⚠️ تم رفض مهمة', task.data?.email_subject ?? '');
  }
}

export async function addComment(taskId, userId, notes) {
  await supabase.from('task_actions').insert({ task_id: taskId, user_id: userId, action: 'comment', notes });
}

export async function reassignTask(taskId, newAssignedTo, userId, notes = '') {
  const { data: assigneeProfile } = await supabase.from('profiles').select('role').eq('id', newAssignedTo).single();
  const newStatus = assigneeProfile?.role === 'accountant2' ? 'pending_acc2' : 'pending_acc1';
  await supabase.from('tasks').update({ assigned_to: newAssignedTo, status: newStatus }).eq('id', taskId);
  await supabase.from('task_actions').insert({ task_id: taskId, user_id: userId, action: 'reassigned', notes });
  const task = await supabase.from('tasks').select('email_subject').eq('id', taskId).single();
  await notify(newAssignedTo, taskId, '📋 تم تحويل مهمة إليك', task.data?.email_subject ?? '');
}

// ── Auto-assign new task based on attachments ──────────────────────────────────
export async function assignTaskByType(taskId, hasExcel, hasPdf) {
  let targetRole  = 'accountant1';
  let nextStatus  = 'pending_acc1';

  if (!hasExcel && hasPdf) {
    targetRole = 'accountant2';
    nextStatus = 'pending_acc2';
  }

  const target = await getProfileByRole(targetRole);
  if (!target) return;

  await supabase.from('tasks').update({
    status: nextStatus, assigned_to: target.id,
    has_excel: hasExcel, has_pdf: hasPdf,
  }).eq('id', taskId);

  await notify(target.id, taskId,
    `📨 مهمة مالية جديدة`,
    hasExcel && hasPdf ? 'يحتوي على Excel و PDF'
      : hasExcel ? 'يحتوي على ملف Excel'
      : 'يحتوي على ملف PDF'
  );
}

// ── Notifications ─────────────────────────────────────────────────────────────
export async function notify(userId, taskId, title, message = '', type = 'info') {
  await supabase.from('notifications').insert({ user_id: userId, task_id: taskId, title, message, type });
}

export async function getUnreadCount(userId) {
  const { count } = await supabase
    .from('notifications').select('*', { count: 'exact', head: true })
    .eq('user_id', userId).eq('read', false);
  return count ?? 0;
}

export async function getNotifications(userId, limit = 20) {
  const { data } = await supabase
    .from('notifications').select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function markAllRead(userId) {
  await supabase.from('notifications').update({ read: true })
    .eq('user_id', userId).eq('read', false);
}

// ── File upload ───────────────────────────────────────────────────────────────
export async function uploadFile(file, taskId) {
  const ext  = file.name.split('.').pop();
  const path = `${taskId}/${Date.now()}_${file.name}`;
  const { error } = await supabase.storage.from('task-files').upload(path, file);
  if (error) throw error;

  const fileType = ['xlsx','xls','csv'].includes(ext.toLowerCase()) ? 'excel'
    : ext.toLowerCase() === 'pdf' ? 'pdf' : 'other';

  return { filename: file.name, file_type: fileType, storage_path: path, file_size: file.size };
}

export async function getFileUrl(path) {
  const { data } = await supabase.storage.from('task-files').createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

export async function getAllTaskIds(profile, {
  attachFilter = 'all', search = '', priority = 'all',
  dateFrom = '', dateTo = '', assignedTo = 'all',
  isFinancial = 'all', hideCompleted = false,
  readFilter = 'all', source = 'all', senderEmails = [],
  statusFilter = 'all', viewedFilter = 'all',
} = {}) {
  let q = supabase.from('tasks').select('id').eq('is_deleted', false);

  if (profile.role !== 'admin') q = q.eq('assigned_to', profile.id);

  if (attachFilter === 'excel') {
    q = q.eq('has_excel', true).eq('has_pdf', false);
  } else if (attachFilter === 'pdf') {
    q = q.eq('has_pdf', true).eq('has_excel', false);
  } else if (attachFilter === 'both') {
    q = q.eq('has_excel', true).eq('has_pdf', true);
  } else if (attachFilter === 'none') {
    q = q.eq('has_excel', false).eq('has_pdf', false);
  }

  if (search.trim()) {
    const qs = `%${search.trim()}%`;
    q = q.or(`email_subject.ilike.${qs},email_from.ilike.${qs},email_from_name.ilike.${qs},ai_summary.ilike.${qs}`);
  }

  if (priority !== 'all') q = q.eq('priority', priority);
  if (dateFrom) q = q.gte('email_date', dateFrom);
  if (dateTo)   q = q.lte('email_date', dateTo + 'T23:59:59Z');

  if (profile.role === 'admin' && assignedTo !== 'all') {
    if (assignedTo === 'unassigned') q = q.is('assigned_to', null);
    else q = q.eq('assigned_to', assignedTo);
  }

  if (hideCompleted) {
    const done = ['approved', 'rejected', 'not_financial', 'approved_acc1', 'rejected_acc1'];
    q = q.not('status', 'in', `(${done.join(',')})`);
  }

  if (isFinancial === 'yes')    q = q.eq('ai_is_financial', true);
  else if (isFinancial === 'no') q = q.eq('ai_is_financial', false);

  if (readFilter === 'unread')   q = q.eq('is_read', false);
  else if (readFilter === 'read') q = q.eq('is_read', true);

  if (source !== 'all') q = q.eq('source', source);
  if (senderEmails?.length) q = q.in('email_from', senderEmails);
  if (statusFilter !== 'all') q = q.eq('status', statusFilter);
  if (viewedFilter === 'viewed')     q = q.not('last_viewed_at', 'is', null);
  else if (viewedFilter === 'not_viewed') q = q.is('last_viewed_at', null);

  const { data } = await q;
  return data?.map(t => t.id) ?? [];
}

export async function logTaskView(taskId, userId) {
  await Promise.all([
    supabase.from('task_actions').insert({
      task_id: taskId, user_id: userId, action: 'viewed', notes: 'فتح الإيميل',
    }),
    supabase.from('tasks').update({ last_viewed_at: new Date().toISOString() }).eq('id', taskId),
  ]);
}

export async function markTaskRead(taskId) {
  await supabase.from('tasks').update({ is_read: true }).eq('id', taskId);
}

export async function getAttachmentCounts(profile) {
  const makeQ = () => {
    let q = supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('is_deleted', false);
    if (profile.role !== 'admin') q = q.eq('assigned_to', profile.id);
    return q;
  };
  const [r1, r2, r3, r4] = await Promise.all([
    makeQ().eq('has_excel', true).eq('has_pdf', false),
    makeQ().eq('has_pdf', true).eq('has_excel', false),
    makeQ().eq('has_excel', true).eq('has_pdf', true),
    makeQ().eq('has_excel', false).eq('has_pdf', false),
  ]);
  return {
    excel: r1.count ?? 0,
    pdf:   r2.count ?? 0,
    both:  r3.count ?? 0,
    none:  r4.count ?? 0,
  };
}

export async function getAllSenders(profile) {
  const { data } = await supabase.rpc('get_sender_counts', {
    p_user_id: profile.id,
    p_role:    profile.role,
  });
  return (data ?? []).map(r => ({
    email: r.email_from,
    name:  r.email_from_name || r.email_from,
    count: Number(r.cnt),
  }));
}

export async function deleteTask(taskId, userId) {
  const now = new Date().toISOString();
  const { error } = await supabase.from('tasks')
    .update({ is_deleted: true, deleted_at: now })
    .eq('id', taskId);
  if (error) throw error;
  if (userId) {
    await supabase.from('task_actions').insert({
      task_id: taskId, user_id: userId, action: 'deleted', notes: 'تم النقل إلى سلة المهملات',
    });
  }
}

export async function bulkDeleteTasks(taskIds, userId) {
  if (!taskIds.length) return;
  const CHUNK = 50;
  const now = new Date().toISOString();
  for (let i = 0; i < taskIds.length; i += CHUNK) {
    const chunk = taskIds.slice(i, i + CHUNK);
    const { error } = await supabase.from('tasks')
      .update({ is_deleted: true, deleted_at: now })
      .in('id', chunk);
    if (error) throw error;
    if (userId) {
      await supabase.from('task_actions').insert(
        chunk.map(id => ({ task_id: id, user_id: userId, action: 'deleted', notes: 'حذف جماعي' }))
      );
    }
  }
}

export async function restoreTask(taskId) {
  const { error } = await supabase.from('tasks')
    .update({ is_deleted: false, deleted_at: null })
    .eq('id', taskId);
  if (error) throw error;
}

export async function permanentDeleteTask(taskId) {
  await supabase.from('attachments').delete().eq('task_id', taskId);
  await supabase.from('task_actions').delete().eq('task_id', taskId);
  await supabase.from('notifications').delete().eq('task_id', taskId);
  const { error } = await supabase.from('tasks').delete().eq('id', taskId);
  if (error) throw error;
}

export async function getDeletedTasks(profile) {
  let q = supabase.from('tasks')
    .select(`*, assigned_profile:profiles!tasks_assigned_to_fkey(id,name,role,avatar_color)`)
    .eq('is_deleted', true)
    .order('deleted_at', { ascending: false })
    .limit(200);
  if (profile.role !== 'admin') q = q.eq('assigned_to', profile.id);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}
