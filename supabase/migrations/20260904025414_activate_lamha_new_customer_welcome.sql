-- The transaction-only dry run passed against the latest accepted Lamha
-- snapshot. Activation does not queue or send anything by itself; delivery is
-- triggered only after the next successful Lamha synchronization.

update public.automation_rules
set
  status = 'active',
  execution_mode = 'automatic',
  version = version + 1,
  updated_at = now()
where rule_key = 'welcome_new_customer'
  and trigger_source = 'lamha'
  and event_type = 'new_customer'
  and template_name = 'masrah'
  and template_variables = '[{"position":1,"mode":"fixed","value":"معاذ"},{"position":2,"mode":"fixed","value":"اتواصل معكم بخوص تسجيلكم في المنصه"}]'::jsonb
  and safeguards->>'dedupeMode' = 'once_per_snapshot_phone'
  and coalesce((schedule_config->>'afterSuccessfulSync')::boolean, false) is true;

do $block$
begin
  if not exists (
    select 1
    from public.automation_rules
    where rule_key = 'welcome_new_customer'
      and status = 'active'
      and execution_mode = 'automatic'
  ) then
    raise exception 'welcome_automation_activation_preconditions_failed';
  end if;
end;
$block$;

insert into public.automation_rule_versions (rule_id, version, snapshot, change_note)
select
  rule.id,
  rule.version,
  to_jsonb(rule) - 'last_preview_at' - 'last_preview_count' - 'last_run_at' - 'next_run_at',
  'تفعيل ترحيب masrah بعد نجاح الفحص الجاف دون إرسال'
from public.automation_rules rule
where rule.rule_key = 'welcome_new_customer'
on conflict (rule_id, version) do nothing;
