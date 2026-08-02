-- Work agents registry: definitions and immutable execution history.
-- Agents are created disabled/draft. Scheduling and sensitive actions are added one agent at a time.
create table if not exists public.work_agents (
  id uuid primary key default gen_random_uuid(),
  agent_key text not null unique,
  name text not null,
  description text not null default '',
  category text not null,
  status text not null default 'draft' check (status in ('draft','active','paused','error')),
  cadence_label text not null,
  cron_expression text,
  timezone text not null default 'Asia/Riyadh',
  safety_level text not null default 'monitor' check (safety_level in ('monitor','limited','approval','sensitive')),
  sources jsonb not null default '[]'::jsonb,
  config jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.work_agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.work_agents(id) on delete cascade,
  status text not null check (status in ('queued','running','succeeded','partial','failed','cancelled')),
  trigger_type text not null default 'schedule' check (trigger_type in ('schedule','manual','event','retry')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  checked_count integer not null default 0 check (checked_count >= 0),
  action_count integer not null default 0 check (action_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  summary text,
  details jsonb not null default '{}'::jsonb,
  approved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists work_agent_runs_agent_started_idx on public.work_agent_runs(agent_id, started_at desc);
alter table public.work_agents enable row level security;
alter table public.work_agent_runs enable row level security;
grant select, insert, update, delete on table public.work_agents to authenticated;
grant select on table public.work_agent_runs to authenticated;
grant select, insert, update, delete on table public.work_agents, public.work_agent_runs to service_role;

drop policy if exists work_agents_read on public.work_agents;
create policy work_agents_read on public.work_agents for select to authenticated using (
  exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='admin' or coalesce((p.permissions->>'agents.view')::boolean,false)))
);
drop policy if exists work_agents_admin_write on public.work_agents;
create policy work_agents_admin_write on public.work_agents for all to authenticated using (
  exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin')
) with check (
  exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin')
);
drop policy if exists work_agent_runs_read on public.work_agent_runs;
create policy work_agent_runs_read on public.work_agent_runs for select to authenticated using (
  exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='admin' or coalesce((p.permissions->>'agents.view')::boolean,false)))
);

insert into public.work_agents(agent_key,name,description,category,cadence_label,safety_level,sources) values
('new_leads','وكيل العملاء الجدد','يستقبل المهتمين، يمنع التكرار، يطابق المنصة ثم يوزعهم على الموظفين.','المبيعات','كل 5 دقائق','limited','["Google Sheets","المنصة","هاتف"]'),
('zatca_nightly','وكيل زاتكا الليلي','يفحص فواتير اليوم غير المرسلة ويجهز الإرسال من خلال Zoho.','المالية','يوميًا 11:45 م','approval','["Zoho Books","زاتكا"]'),
('integration_health','وكيل صحة التكاملات','يراقب Zoho وهاتف والمنصة والويب هوك وينبه عند توقف أي مصدر.','الرقابة','كل ساعة','monitor','["Zoho Books","هاتف","المنصة","Webhooks"]'),
('daily_collections','وكيل التحصيل اليومي','يرتب الديون والوعود المستحقة ويقترح قائمة اتصال لكل موظف.','التحصيل','يوميًا 9:00 ص','approval','["Zoho Books","هاتف","ملف العميل"]'),
('bank_reconciliation','وكيل المطابقة البنكية','يستبعد المراجع المكررة ويقترح تصنيف ومطابقة العمليات الجديدة.','البنوك','عند وصول كشف','approval','["البنوك","Zoho Books"]'),
('weekly_team','وكيل تقرير الفريق','يلخص التوزيع وزمن أول تواصل والمتابعات المتأخرة وأداء كل فريق.','الإدارة','أسبوعيًا','monitor','["هاتف","المبيعات","سجل النشاط"]'),
('monthly_close','وكيل الإقفال الشهري','يجمع فحوص الإقفال ويمنع اعتماده قبل معالجة الفروقات.','المالية','نهاية كل شهر','approval','["Zoho Books","البنوك","الناقلون","زاتكا"]')
on conflict(agent_key) do update set name=excluded.name, description=excluded.description, category=excluded.category, cadence_label=excluded.cadence_label, safety_level=excluded.safety_level, sources=excluded.sources, updated_at=now();
