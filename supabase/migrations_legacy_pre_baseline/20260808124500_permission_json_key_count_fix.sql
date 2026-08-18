-- PostgreSQL has no built-in function for counting JSON object keys.
-- Count permission keys with jsonb_object_keys() in both authorization paths
-- so saving permissions and writing the audit trail remain atomic.

create or replace function public.log_profile_authorization_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_actor_email text;
  v_added text[] := array[]::text[];
  v_removed text[] := array[]::text[];
  v_before_count integer := 0;
  v_after_count integer := 0;
begin
  select profile.name, profile.email
    into v_actor_name, v_actor_email
  from public.profiles profile
  where profile.id = v_actor;

  if new.permissions is distinct from old.permissions then
    select coalesce(array_agg(key order by key), array[]::text[])
      into v_added
    from jsonb_object_keys(coalesce(new.permissions, '{}'::jsonb)) as key
    where not (coalesce(old.permissions, '{}'::jsonb) ? key);

    select coalesce(array_agg(key order by key), array[]::text[])
      into v_removed
    from jsonb_object_keys(coalesce(old.permissions, '{}'::jsonb)) as key
    where not (coalesce(new.permissions, '{}'::jsonb) ? key);

    select count(*)::integer
      into v_before_count
    from jsonb_object_keys(coalesce(old.permissions, '{}'::jsonb));

    select count(*)::integer
      into v_after_count
    from jsonb_object_keys(coalesce(new.permissions, '{}'::jsonb));

    insert into public.user_activity_log (user_id, kind, action, detail, path)
    values (
      new.id,
      'action',
      'permissions_changed',
      jsonb_build_object(
        'employee_id', new.id,
        'employee_name', new.name,
        'employee_email', new.email,
        'actor_id', v_actor,
        'actor_name', v_actor_name,
        'actor_email', v_actor_email,
        'added_keys', to_jsonb(v_added),
        'removed_keys', to_jsonb(v_removed),
        'before_count', v_before_count,
        'after_count', v_after_count
      ),
      '/employees'
    );
  end if;

  if new.role is distinct from old.role then
    insert into public.user_activity_log (user_id, kind, action, detail, path)
    values (
      new.id,
      'action',
      'employee_role_changed',
      jsonb_build_object(
        'employee_id', new.id,
        'employee_name', new.name,
        'employee_email', new.email,
        'actor_id', v_actor,
        'actor_name', v_actor_name,
        'actor_email', v_actor_email,
        'before_role', old.role,
        'after_role', new.role
      ),
      '/employees'
    );
  end if;

  return new;
end;
$$;

revoke all on function public.log_profile_authorization_change() from public, anon, authenticated;

create or replace function public.update_employee_permissions(
  p_employee uuid,
  p_permissions jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_after jsonb;
  v_target_name text;
  v_added text[];
  v_removed text[];
  v_before_count integer := 0;
  v_after_count integer := 0;
begin
  if v_actor is null or not public.crm_has_permission('system.manage_permissions') then
    raise exception 'forbidden';
  end if;

  if jsonb_typeof(coalesce(p_permissions, '{}'::jsonb)) <> 'object' then
    raise exception 'permissions_must_be_an_object';
  end if;

  if exists (
    select 1
    from jsonb_each(coalesce(p_permissions, '{}'::jsonb)) item
    where jsonb_typeof(item.value) <> 'boolean'
  ) then
    raise exception 'permission_values_must_be_boolean';
  end if;

  select coalesce(jsonb_object_agg(item.key, true), '{}'::jsonb)
    into v_after
  from jsonb_each(coalesce(p_permissions, '{}'::jsonb)) item
  where item.value = 'true'::jsonb;

  select coalesce(profile.permissions, '{}'::jsonb), profile.name
    into v_before, v_target_name
  from public.profiles profile
  where profile.id = p_employee
    and profile.role <> 'admin'
  for update;

  if not found then
    raise exception 'employee_not_found_or_admin';
  end if;

  select coalesce(array_agg(key order by key), array[]::text[])
    into v_added
  from jsonb_object_keys(v_after) as key
  where not (v_before ? key);

  select coalesce(array_agg(key order by key), array[]::text[])
    into v_removed
  from jsonb_object_keys(v_before) as key
  where not (v_after ? key);

  select count(*)::integer into v_before_count from jsonb_object_keys(v_before);
  select count(*)::integer into v_after_count from jsonb_object_keys(v_after);

  if v_before is distinct from v_after then
    update public.profiles
    set permissions = v_after
    where id = p_employee;
  end if;

  return jsonb_build_object(
    'employee_id', p_employee,
    'employee_name', v_target_name,
    'changed', v_before is distinct from v_after,
    'before_count', v_before_count,
    'after_count', v_after_count,
    'added_keys', to_jsonb(v_added),
    'removed_keys', to_jsonb(v_removed)
  );
end;
$$;

revoke all on function public.update_employee_permissions(uuid, jsonb) from public, anon;
grant execute on function public.update_employee_permissions(uuid, jsonb) to authenticated;
