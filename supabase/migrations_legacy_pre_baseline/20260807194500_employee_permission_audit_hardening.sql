-- Attribute authorization changes to the affected employee's activity trail,
-- preserve the administrator identity in the immutable event details, and
-- prevent the trigger function from being invoked as a public RPC.

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
    where not (coalesce(old.permissions, '{}'::jsonb) ? key);

    select coalesce(array_agg(key order by key), array[]::text[])
      into v_removed
    from jsonb_object_keys(coalesce(old.permissions, '{}'::jsonb)) as key
    where not (coalesce(new.permissions, '{}'::jsonb) ? key);

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

alter function public.update_employee_permissions(uuid, jsonb)
  set search_path = '';
