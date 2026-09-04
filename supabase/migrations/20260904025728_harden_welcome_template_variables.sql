create or replace function private.validate_automation_rule_activation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.status = 'active' and new.execution_mode = 'automatic' then
    if nullif(trim(new.template_name), '') is null then
      raise exception 'active_automation_template_required';
    end if;

    if jsonb_typeof(new.template_variables) <> 'array'
       or jsonb_array_length(new.template_variables) = 0
       or exists (
         select 1
         from jsonb_array_elements(new.template_variables) variable
         where nullif(trim(variable->>'value'), '') is null
       ) then
      raise exception 'active_automation_variables_required';
    end if;

    if coalesce((new.schedule_config->>'afterSuccessfulSync')::boolean, false) is not true then
      raise exception 'active_automation_successful_sync_required';
    end if;

    if new.rule_key = 'welcome_new_customer' then
      if new.template_name = 'masrah'
         and jsonb_array_length(new.template_variables) < 2 then
        raise exception 'welcome_automation_two_variables_required';
      end if;

      if coalesce(new.safeguards->>'dedupeMode', '') <> 'once_per_snapshot_phone' then
        raise exception 'welcome_automation_snapshot_dedupe_required';
      end if;
    end if;
  end if;

  return new;
end;
$function$;
