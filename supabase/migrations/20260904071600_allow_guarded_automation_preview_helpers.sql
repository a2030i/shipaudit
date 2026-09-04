-- The public preview RPC is SECURITY INVOKER, so its authenticated caller must
-- be able to execute the private helpers it delegates to. The private schema is
-- not exposed by the Data API and both helpers enforce agents.view internally.
grant usage on schema private to authenticated;
grant execute on function private.automation_preview_payload(public.automation_rules) to authenticated;
grant execute on function private.financial_automation_preview_payload(public.automation_rules) to authenticated;

revoke execute on function private.automation_preview_payload(public.automation_rules) from public, anon;
revoke execute on function private.financial_automation_preview_payload(public.automation_rules) from public, anon;
