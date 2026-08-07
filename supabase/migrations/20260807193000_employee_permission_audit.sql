-- Permission changes are authorization events, not ordinary profile edits.
-- Keep the browser on a narrow RPC and record the exact delta for every
-- path (including a direct admin update) through the database trigger.

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
begin
  select profile.name, profile.email
    into v_actor_name, v_actor_email
  from public.profiles profile
  where profile.id = v_actor;

  if new.permissions is distinct from old.permissions then
    select coalesce(array_agg(key order by key), array[]::text[])
      into v_added
    from jsonb_object_keys(coalesce(new.permissions, '{}'::jsonb)) as key
    where not coalesce(old.permissions, '{}'::jsonb) ? key;

    select coalesce(array_agg(key order by key), array[]::text[])
      into v_removed
    from jsonb_object_keys(coalesce(old.permissions, '{}'::jsonb)) as key
    where not coalesce(new.permissions, '{}'::jsonb) ? key;

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
        'before_count', jsonb_object_length(coalesce(old.permissions, '{}'::jsonb)),
        'after_count', jsonb_object_length(coalesce(new.permissions, '{}'::jsonb))
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

drop trigger if exists profile_authorization_change_audit on public.profiles;
create trigger profile_authorization_change_audit
after update of permissions, role on public.profiles
for each row execute function public.log_profile_authorization_change();

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
  where not v_before ? key;

  select coalesce(array_agg(key order by key), array[]::text[])
    into v_removed
  from jsonb_object_keys(v_before) as key
  where not v_after ? key;

  if v_before is distinct from v_after then
    update public.profiles
    set permissions = v_after
    where id = p_employee;
  end if;

  return jsonb_build_object(
    'employee_id', p_employee,
    'employee_name', v_target_name,
    'changed', v_before is distinct from v_after,
    'before_count', jsonb_object_length(v_before),
    'after_count', jsonb_object_length(v_after),
    'added_keys', to_jsonb(v_added),
    'removed_keys', to_jsonb(v_removed)
  );
end;
$$;

revoke all on function public.update_employee_permissions(uuid, jsonb) from public, anon;
grant execute on function public.update_employee_permissions(uuid, jsonb) to authenticated;
