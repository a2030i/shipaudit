drop policy if exists collection_tasks_all on public.collection_tasks;
drop policy if exists collection_tasks_select on public.collection_tasks;
drop policy if exists collection_tasks_insert on public.collection_tasks;
drop policy if exists collection_tasks_update on public.collection_tasks;
drop policy if exists collection_tasks_delete on public.collection_tasks;

create policy collection_tasks_select on public.collection_tasks
for select to authenticated using (
  public.crm_has_permission('collections.view')
  and (assigned_to=(select auth.uid()) or public.collection_can_see_all())
);
create policy collection_tasks_insert on public.collection_tasks
for insert to authenticated with check (
  public.crm_has_permission('collections.create_task')
  and (assigned_to=(select auth.uid()) or public.collection_can_see_all())
);
create policy collection_tasks_update on public.collection_tasks
for update to authenticated
using (
  public.crm_has_permission('collections.update_stage')
  and (assigned_to=(select auth.uid()) or public.collection_can_see_all())
)
with check (
  public.crm_has_permission('collections.update_stage')
  and (assigned_to=(select auth.uid()) or public.collection_can_see_all())
);
create policy collection_tasks_delete on public.collection_tasks
for delete to authenticated using (
  public.crm_has_permission('collections.delete_task')
  and (assigned_to=(select auth.uid()) or public.collection_can_see_all())
);
