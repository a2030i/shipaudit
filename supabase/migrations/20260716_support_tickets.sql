-- تذاكر خدمة العملاء (§1.35): نموذج /ticket السريع + لوحة /support
-- المشكلة: مشاكل العملاء في محادثات هاتف تضيع — لا رقم مرجعي ولا حالة ولا مسؤول.
-- (مُطبَّقة على FIN عبر MCP باسم support_tickets — هذه نسخة المستودع)

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_no bigint generated always as identity,
  store_id text,
  store_name text not null,
  customer_phone text,
  title text not null,
  description text,
  carrier_id text,
  carrier_name text,
  awb text,
  status text not null default 'open'
    check (status in ('open','in_progress','waiting_customer','resolved','closed')),
  source text not null default 'form',
  created_by uuid references public.profiles(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index if not exists support_tickets_no_idx on public.support_tickets(ticket_no);
create index if not exists support_tickets_status_idx on public.support_tickets(status, created_at desc);
create index if not exists support_tickets_carrier_idx on public.support_tickets(carrier_id);

-- سجل الأحداث: كل تغيير حالة/تعليق/إسناد — أساس إشعارات واتساب مستقبلاً
create table if not exists public.support_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  kind text not null default 'comment' check (kind in ('create','status','assign','comment')),
  old_status text,
  new_status text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists support_ticket_events_ticket_idx on public.support_ticket_events(ticket_id, created_at);

-- updated_at تلقائياً
create or replace function public.touch_support_ticket()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists support_tickets_touch on public.support_tickets;
create trigger support_tickets_touch before update on public.support_tickets
for each row execute function public.touch_support_ticket();

-- RLS: نمط التطبيق — authenticated CRUD والبوابة الوظيفية can() بالواجهة
alter table public.support_tickets enable row level security;
alter table public.support_ticket_events enable row level security;
create policy support_tickets_select on public.support_tickets for select to authenticated using (true);
create policy support_tickets_insert on public.support_tickets for insert to authenticated with check (true);
create policy support_tickets_update on public.support_tickets for update to authenticated using (true);
create policy support_tickets_delete on public.support_tickets for delete to authenticated using (true);
create policy support_ticket_events_select on public.support_ticket_events for select to authenticated using (true);
create policy support_ticket_events_insert on public.support_ticket_events for insert to authenticated with check (true);

-- إحصائيات رأس اللوحة
create or replace function public.support_ticket_stats()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'open',        count(*) filter (where status = 'open'),
    'in_progress', count(*) filter (where status = 'in_progress'),
    'waiting',     count(*) filter (where status = 'waiting_customer'),
    'stale3d',     count(*) filter (where status in ('open','in_progress','waiting_customer')
                                    and created_at < now() - interval '3 days'),
    'resolved7d',  count(*) filter (where status in ('resolved','closed')
                                    and coalesce(resolved_at, updated_at) > now() - interval '7 days'),
    'total',       count(*)
  ) from support_tickets;
$$;
revoke all on function public.support_ticket_stats() from public, anon;
grant execute on function public.support_ticket_stats() to authenticated;
