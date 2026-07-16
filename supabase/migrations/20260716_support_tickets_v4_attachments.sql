-- تذاكر v4 (§1.35): المرفقات — bucket خاص + جدول + حدث 'attach'
-- (مُطبَّقة على FIN عبر MCP باسم support_tickets_v4_attachments)
insert into storage.buckets (id, name, public)
values ('support-attachments', 'support-attachments', false)
on conflict (id) do nothing;

-- سياسات التخزين: قراءة/رفع للموظفين المسجّلين، حذف كذلك (بوابة can() بالواجهة)
do $$ begin
  create policy support_att_read on storage.objects
    for select to authenticated using (bucket_id = 'support-attachments');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy support_att_write on storage.objects
    for insert to authenticated with check (bucket_id = 'support-attachments');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy support_att_delete on storage.objects
    for delete to authenticated using (bucket_id = 'support-attachments');
exception when duplicate_object then null; end $$;

-- جدول المرفقات: الاسم العربي في file_name والمفتاح ASCII في file_path (فخّ §1.7)
create table if not exists public.support_ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  size_bytes bigint,
  mime text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists support_ticket_attachments_ticket_idx
  on public.support_ticket_attachments(ticket_id, created_at);

alter table public.support_ticket_attachments enable row level security;
create policy support_att_rows_select on public.support_ticket_attachments for select to authenticated using (true);
create policy support_att_rows_insert on public.support_ticket_attachments for insert to authenticated with check (true);
create policy support_att_rows_delete on public.support_ticket_attachments for delete to authenticated using (true);

-- نوع حدث جديد 'attach' في سجل التذكرة
alter table public.support_ticket_events drop constraint if exists support_ticket_events_kind_check;
alter table public.support_ticket_events add constraint support_ticket_events_kind_check
  check (kind in ('create','status','assign','comment','attach'));
