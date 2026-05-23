import { supabase } from './supabase.js';

export async function loadEmployees() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email, role, avatar_color, permissions, created_at')
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

export async function createEmployee({ email, password, name, role, avatar_color, permissions }) {
  return callManageUsers({
    action: 'create',
    email, password, name,
    role: role || 'accountant',
    avatar_color,
    permissions: permissions || {},
  });
}

// Profile fields the admin can update directly (RLS allows admin via
// the profiles_admin policy). Permissions go in the same call.
export async function updateEmployee(id, { name, role, avatar_color, permissions }) {
  const updates = {};
  if (name         !== undefined) updates.name         = name;
  if (role         !== undefined) updates.role         = role;
  if (avatar_color !== undefined) updates.avatar_color = avatar_color;
  if (permissions  !== undefined) updates.permissions  = permissions;
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
