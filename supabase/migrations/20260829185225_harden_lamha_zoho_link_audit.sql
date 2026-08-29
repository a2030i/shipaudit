-- The identity correction log is evidence, not mutable application state.
revoke update, delete, truncate on table public.lamha_zoho_link_audit from service_role;
grant select, insert on table public.lamha_zoho_link_audit to service_role;
