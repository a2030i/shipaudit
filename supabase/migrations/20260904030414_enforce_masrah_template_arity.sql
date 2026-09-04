create or replace function private.validate_masrah_template_arity()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.rule_key = 'welcome_new_customer'
     and new.template_name = 'masrah'
     and new.status = 'active'
     and new.execution_mode = 'automatic' then
    if jsonb_typeof(new.template_variables) <> 'array' then
      raise exception 'welcome_automation_exactly_two_variables_required';
    end if;
    if jsonb_array_length(new.template_variables) <> 2 then
      raise exception 'welcome_automation_exactly_two_variables_required';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists automation_rules_validate_masrah_arity
  on public.automation_rules;
create trigger automation_rules_validate_masrah_arity
  before insert or update on public.automation_rules
  for each row execute function private.validate_masrah_template_arity();
