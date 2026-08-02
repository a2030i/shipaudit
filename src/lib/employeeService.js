import { supabase } from './supabase.js';

export async function loadEmployees() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email, role, avatar_color, permissions, lead_notification_phone, accepts_campaign_leads, created_at')
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

async function callManageUsers(body) {
  const { data: { session } } = await supabase.auth.getSession();
  const { data, error } = await supabase.functions.invoke('manage-users', {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function createEmployee({ email, password, name, role, avatar_color, permissions, lead_notification_phone, accepts_campaign_leads }) {
  return callManageUsers({
    action: 'create',
    email, password, name,
    role: role || 'accountant',
    avatar_color,
    permissions: permissions || {},
    lead_notification_phone: lead_notification_phone || null,
    accepts_campaign_leads: accepts_campaign_leads === true,
  });
}

// Profile fields the admin can update directly (RLS allows admin via
// the profiles_admin policy). Permissions go in the same call.
export async function updateEmployee(id, { name, role, avatar_color, permissions, lead_notification_phone, accepts_campaign_leads }) {
  const updates = {};
  if (name         !== undefined) updates.name         = name;
  if (role         !== undefined) updates.role         = role;
  if (avatar_color !== undefined) updates.avatar_color = avatar_color;
  if (permissions  !== undefined) updates.permissions  = permissions;
  if (lead_notification_phone !== undefined) updates.lead_notification_phone = lead_notification_phone || null;
  if (accepts_campaign_leads !== undefined) updates.accepts_campaign_leads = accepts_campaign_leads === true;
  const { error } = await supabase.from('profiles').update(updates).eq('id', id);
  if (error) throw error;
}

// Just the permissions JSONB. Separate helper because the permissions
// editor saves often and shouldn't risk overwriting name/role.
export async function updateEmployeePermissions(id, permissions) {
  const { error } = await supabase
    .from('profiles')
    .update({ permissions: permissions || {} })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteEmployee(user_id) {
  return callManageUsers({ action: 'delete', user_id });
}

// ── سجل تحركات الموظفين (§1.36) — RPCs مدير-فقط ──────────────────────
// ملخّص لكل موظف: آخر دخول (auth.users) + آخر حركة + عدّادات 7 أيام
export async function loadEmployeeActivitySummary() {
  const { data, error } = await supabase.rpc('employee_activity_summary');
  if (error) throw error;
  const map = new Map();
  for (const r of (Array.isArray(data) ? data : [])) {
    map.set(r.user_id, {
      lastSignIn: r.last_sign_in || null,
      lastAction: r.last_action || null,
      lastActionAt: r.last_action_at || null,
      lastIp: r.last_ip || null,
      lastCountry: r.last_country || null,
      actions7d: Number(r.actions_7d) || 0,
      denied7d: Number(r.denied_7d) || 0,
    });
  }
  return map;
}

// السجل التفصيلي لموظف واحد (مع فلتر نوع + ترقيم)
export async function loadEmployeeActivity(userId, { kind = null, limit = 100, offset = 0 } = {}) {
  const { data, error } = await supabase.rpc('employee_activity_log', {
    p_user: userId, p_kind: kind || null, p_limit: limit, p_offset: offset,
  });
  if (error) throw error;
  return (data || []).map(r => ({
    id: r.id, kind: r.kind, action: r.action, detail: r.detail,
    path: r.path, ip: r.ip, country: r.country, createdAt: r.created_at,
  }));
}
