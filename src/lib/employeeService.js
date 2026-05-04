import { supabase } from './supabase.js';

export async function loadEmployees() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email, role, avatar_color, created_at')
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

export async function createEmployee({ email, password, name, role, avatar_color }) {
  return callManageUsers({ action: 'create', email, password, name, role, avatar_color });
}

export async function updateEmployee(id, { name, role, avatar_color }) {
  const updates = {};
  if (name         !== undefined) updates.name         = name;
  if (role         !== undefined) updates.role         = role;
  if (avatar_color !== undefined) updates.avatar_color = avatar_color;
  const { error } = await supabase.from('profiles').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteEmployee(user_id) {
  return callManageUsers({ action: 'delete', user_id });
}
