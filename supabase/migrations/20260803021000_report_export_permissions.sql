-- Report files and their history follow explicit view/export permissions.

alter table public.internal_export_pulls enable row level security;
drop policy if exists iep_read on public.internal_export_pulls;
drop policy if exists iep_insert on public.internal_export_pulls;

create policy iep_read
  on public.internal_export_pulls for select to authenticated
  using (
    public.crm_has_permission('internal_exports.view')
    or public.crm_has_permission('reports.export')
  );

create policy iep_insert
  on public.internal_export_pulls for insert to authenticated
  with check (
    public.crm_has_permission('internal_exports.pull')
    or public.crm_has_permission('reports.export')
  );

drop policy if exists internal_exports_authenticated_all on storage.objects;
drop policy if exists internal_exports_read on storage.objects;
drop policy if exists internal_exports_insert on storage.objects;
drop policy if exists internal_exports_delete_admin on storage.objects;
create policy internal_exports_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'internal-exports'
    and (
      public.crm_has_permission('internal_exports.view')
      or public.crm_has_permission('reports.export')
    )
  );

create policy internal_exports_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'internal-exports'
    and (
      public.crm_has_permission('internal_exports.pull')
      or public.crm_has_permission('reports.export')
    )
  );

create policy internal_exports_delete_admin
  on storage.objects for delete to authenticated
  using (bucket_id = 'internal-exports' and public.is_admin());
