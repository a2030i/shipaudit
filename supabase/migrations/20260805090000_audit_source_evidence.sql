-- Preserve the exact carrier invoice used to produce every v3 audit. The
-- bucket is private and follows the same action-level permissions as audits.
insert into storage.buckets (id, name, public, file_size_limit)
values ('audit-source-files', 'audit-source-files', false, 52428800)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

drop policy if exists audit_source_read on storage.objects;
drop policy if exists audit_source_insert on storage.objects;
drop policy if exists audit_source_update on storage.objects;
drop policy if exists audit_source_delete on storage.objects;

create policy audit_source_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'audit-source-files'
    and public.crm_has_permission('audits.view')
  );

create policy audit_source_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'audit-source-files'
    and public.crm_has_permission('audits.create')
  );

create policy audit_source_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'audit-source-files'
    and public.crm_has_permission('audits.create')
  )
  with check (
    bucket_id = 'audit-source-files'
    and public.crm_has_permission('audits.create')
  );

create policy audit_source_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'audit-source-files'
    and public.crm_has_permission('audits.delete')
  );
