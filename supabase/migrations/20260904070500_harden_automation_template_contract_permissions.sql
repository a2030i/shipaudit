-- Explicitly override project-wide default grants. Managers read contracts;
-- only service_role may maintain the approved registry.
revoke all on table public.automation_template_contracts from authenticated;
grant select on table public.automation_template_contracts to authenticated;

revoke all on function private.financial_automation_preview_payload(public.automation_rules)
  from public, anon, authenticated;
revoke all on function private.validate_automation_rule_activation()
  from public, anon, authenticated;
