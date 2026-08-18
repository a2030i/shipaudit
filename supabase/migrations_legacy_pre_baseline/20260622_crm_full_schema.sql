-- CRM متكامل (تحصيل + مبيعات) — 7 جداول + RLS صارم (المُسنَد له فقط)
-- مُطبَّق على مشروع FIN عبر apply_migration (crm_full_schema) 2026-06-22.
-- يعيد استخدام: customer_receivables (customer_name) · merchants · profiles
-- المفتاح الدائم للعميل = customer_name. الـtimeline polymorphic (entity_type, entity_ref).

create or replace function crm_can_see_all() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and (role = 'admin' or coalesce((permissions->>'crm.view_all')::boolean, false))
  );
$$;

create table if not exists crm_statuses (
  id uuid primary key default gen_random_uuid(),
  key text unique not null, label_ar text not null, color text default '#6B7280',
  sort_order int default 0, is_open boolean default true, is_terminal boolean default false,
  is_default boolean default false, created_at timestamptz default now()
);
create table if not exists crm_stages (
  id uuid primary key default gen_random_uuid(),
  key text unique not null, label_ar text not null, color text default '#3B82F6',
  sort_order int default 0, probability numeric(5,2) default 0,
  is_won boolean default false, is_lost boolean default false, created_at timestamptz default now()
);
create table if not exists crm_customer_crm (
  customer_name text primary key, name_normalized text,
  followup_status_id uuid references crm_statuses(id) on delete set null,
  owner_id uuid references profiles(id) on delete set null,
  in_watch boolean default false, watch_reason text,
  last_activity_at timestamptz, next_action_at timestamptz, segment_tags text[] default '{}',
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists ix_crm_cust_owner on crm_customer_crm(owner_id);
create index if not exists ix_crm_cust_status on crm_customer_crm(followup_status_id);
create index if not exists ix_crm_cust_watch on crm_customer_crm(in_watch) where in_watch;
create index if not exists ix_crm_cust_lastact on crm_customer_crm(last_activity_at);
create table if not exists crm_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null, name_normalized text, phone text, whatsapp text, email text,
  source text default 'manual', snapshot_id text, city text, notes text, status text default 'new',
  owner_id uuid references profiles(id) on delete set null,
  converted_at timestamptz, converted_customer text, converted_store_id text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists ix_crm_leads_norm on crm_leads(name_normalized);
create index if not exists ix_crm_leads_owner on crm_leads(owner_id);
create index if not exists ix_crm_leads_status on crm_leads(status);
create unique index if not exists ux_crm_leads_snap_norm on crm_leads(snapshot_id, name_normalized) where snapshot_id is not null;
create table if not exists crm_deals (
  id uuid primary key default gen_random_uuid(),
  title text not null, entity_type text not null check (entity_type in ('lead','customer')), entity_ref text not null,
  stage_id uuid references crm_stages(id) on delete set null,
  value numeric(14,2) default 0, currency text default 'SAR', expected_close date,
  owner_id uuid references profiles(id) on delete set null,
  status text default 'open' check (status in ('open','won','lost')), lost_reason text,
  opened_at timestamptz default now(), closed_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists ix_crm_deals_owner on crm_deals(owner_id);
create index if not exists ix_crm_deals_stage on crm_deals(stage_id);
create index if not exists ix_crm_deals_entity on crm_deals(entity_type, entity_ref);
create index if not exists ix_crm_deals_status on crm_deals(status);
create table if not exists crm_activities (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('customer','lead','deal')), entity_ref text not null,
  kind text not null, disposition text, summary text, body text,
  promise_amount numeric(14,2), promised_on date, promise_status text, kept_amount numeric(14,2),
  channel_ref text, template_key text, occurred_at timestamptz default now(),
  owner_id uuid references profiles(id) on delete set null,
  created_by uuid references profiles(id) on delete set null, created_at timestamptz default now()
);
create index if not exists ix_crm_act_entity on crm_activities(entity_type, entity_ref, occurred_at desc);
create index if not exists ix_crm_act_promise on crm_activities(promise_status) where kind='promise';
create index if not exists ix_crm_act_owner on crm_activities(owner_id, occurred_at desc);
create table if not exists crm_tasks (
  id uuid primary key default gen_random_uuid(),
  entity_type text check (entity_type in ('customer','lead','deal')), entity_ref text not null,
  title text not null, kind text, due_at timestamptz not null,
  remind_days_before int default 0, remind_channel text default 'popup',
  status text default 'open' check (status in ('open','done','cancelled')), priority text default 'normal',
  source_promise_id uuid references crm_activities(id) on delete set null,
  assigned_to uuid references profiles(id) on delete set null,
  completed_at timestamptz, completed_by uuid references profiles(id) on delete set null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists ix_crm_tasks_assignee on crm_tasks(assigned_to, due_at) where status='open';
create index if not exists ix_crm_tasks_due on crm_tasks(due_at) where status='open';
create index if not exists ix_crm_tasks_entity on crm_tasks(entity_type, entity_ref);

insert into crm_statuses (key,label_ar,color,sort_order,is_open,is_terminal,is_default) values
  ('new','جديد (دخل المتابعة)','#6B7280',10,true,false,true),
  ('contacted','تواصلنا','#3B82F6',20,true,false,false),
  ('promised','وعد بالدفع','#F59E0B',30,true,false,false),
  ('partial','دفعة جزئية','#8B5CF6',40,true,false,false),
  ('escalated','مُصعَّد','#EF4444',50,true,false,false),
  ('dispute_hold','نزاع — معلّق','#EC4899',60,true,false,false),
  ('resolved','محصَّل/مُغلق','#10B981',70,false,true,false),
  ('stopped','أُوقِف العميل','#DC2626',80,false,true,false),
  ('written_off','شطب الدين','#991B1B',90,false,true,false)
on conflict (key) do nothing;
insert into crm_stages (key,label_ar,color,sort_order,probability,is_won,is_lost) values
  ('lead_new','جديد','#6B7280',10,10,false,false),
  ('qualified','مؤهّل','#3B82F6',20,25,false,false),
  ('proposal','عرض مقدّم','#8B5CF6',30,50,false,false),
  ('negotiation','تفاوض','#F59E0B',40,70,false,false),
  ('won','تم الربح','#10B981',50,100,true,false),
  ('lost','خسارة','#DC2626',60,0,false,true)
on conflict (key) do nothing;

alter table crm_statuses enable row level security;
alter table crm_stages enable row level security;
alter table crm_customer_crm enable row level security;
alter table crm_leads enable row level security;
alter table crm_deals enable row level security;
alter table crm_activities enable row level security;
alter table crm_tasks enable row level security;

create policy crm_statuses_all on crm_statuses for all to authenticated using (true) with check (true);
create policy crm_stages_all on crm_stages for all to authenticated using (true) with check (true);

create policy crm_cust_sel on crm_customer_crm for select to authenticated using (owner_id = auth.uid() or crm_can_see_all());
create policy crm_cust_ins on crm_customer_crm for insert to authenticated with check (true);
create policy crm_cust_upd on crm_customer_crm for update to authenticated using (owner_id = auth.uid() or crm_can_see_all()) with check (true);
create policy crm_cust_del on crm_customer_crm for delete to authenticated using (crm_can_see_all());

create policy crm_leads_sel on crm_leads for select to authenticated using (owner_id = auth.uid() or created_by = auth.uid() or crm_can_see_all());
create policy crm_leads_ins on crm_leads for insert to authenticated with check (true);
create policy crm_leads_upd on crm_leads for update to authenticated using (owner_id = auth.uid() or crm_can_see_all()) with check (true);
create policy crm_leads_del on crm_leads for delete to authenticated using (owner_id = auth.uid() or crm_can_see_all());

create policy crm_deals_sel on crm_deals for select to authenticated using (owner_id = auth.uid() or created_by = auth.uid() or crm_can_see_all());
create policy crm_deals_ins on crm_deals for insert to authenticated with check (true);
create policy crm_deals_upd on crm_deals for update to authenticated using (owner_id = auth.uid() or crm_can_see_all()) with check (true);
create policy crm_deals_del on crm_deals for delete to authenticated using (owner_id = auth.uid() or crm_can_see_all());

create policy crm_act_sel on crm_activities for select to authenticated using (
  owner_id = auth.uid() or created_by = auth.uid() or crm_can_see_all()
  or (entity_type='customer' and exists (select 1 from crm_customer_crm cc where cc.customer_name = entity_ref and cc.owner_id = auth.uid()))
  or (entity_type='lead' and exists (select 1 from crm_leads l where l.id::text = entity_ref and l.owner_id = auth.uid()))
  or (entity_type='deal' and exists (select 1 from crm_deals d where d.id::text = entity_ref and d.owner_id = auth.uid()))
);
create policy crm_act_ins on crm_activities for insert to authenticated with check (true);
create policy crm_act_upd on crm_activities for update to authenticated using (created_by = auth.uid() or crm_can_see_all()) with check (true);

create policy crm_tasks_sel on crm_tasks for select to authenticated using (assigned_to = auth.uid() or created_by = auth.uid() or crm_can_see_all());
create policy crm_tasks_ins on crm_tasks for insert to authenticated with check (true);
create policy crm_tasks_upd on crm_tasks for update to authenticated using (assigned_to = auth.uid() or created_by = auth.uid() or crm_can_see_all()) with check (true);
create policy crm_tasks_del on crm_tasks for delete to authenticated using (created_by = auth.uid() or crm_can_see_all());
