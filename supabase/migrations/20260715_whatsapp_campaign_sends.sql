-- سجل إرسال حملات واتساب (Hatif) — أساس «آخر حملة استلمها العميل» و«هل سدّد/تجاوب بعدها».
-- يكتبه hatif-send عند كل إرسال ناجح. يُحدِّث حالته hatif-webhook (Delivered/Read/Failed + الردود).
create table if not exists public.whatsapp_campaign_sends (
  id              bigint generated always as identity primary key,
  phone           text not null,                 -- 9665… مطبَّع (مفتاح الربط بالعميل)
  name            text,
  template_name   text,
  channel_id      text,
  contact_id      text,                           -- معرّف Hatif للجهة (لمطابقة الـwebhook — لا رقم فيه)
  conversation_id text,
  message_id      text,
  campaign_name   text,
  campaign_bucket text,
  amount          numeric,
  status          text default 'accepted',        -- accepted → Sent → Delivered → Read | Failed
  sent_at         timestamptz not null default now(),
  sent_by         text,
  delivered_at    timestamptz,
  read_at         timestamptz,
  replied_at      timestamptz,                     -- أول رد وارد بعد الإرسال
  reply_body      text,
  error_reason    text
);
create index if not exists idx_wcs_phone_sent on public.whatsapp_campaign_sends (phone, sent_at desc);
create index if not exists idx_wcs_contact    on public.whatsapp_campaign_sends (contact_id) where contact_id is not null;
create index if not exists idx_wcs_convo      on public.whatsapp_campaign_sends (conversation_id) where conversation_id is not null;

alter table public.whatsapp_campaign_sends enable row level security;
drop policy if exists wcs_read on public.whatsapp_campaign_sends;
create policy wcs_read on public.whatsapp_campaign_sends for select to authenticated using (true);
-- الكتابة عبر service role فقط (hatif-send / hatif-webhook) — لا سياسة insert/update للمستخدمين.

-- آخر حملة لكل عميل (بالهاتف) + هل سدّد بعدها (دفعة زوهو بعد تاريخ الإرسال، مطابقة بالاسم).
create or replace function public.whatsapp_campaign_status()
returns table (
  phone text, name text, last_template text, last_campaign text,
  last_sent_at timestamptz, last_status text, delivered boolean, read_flag boolean,
  replied boolean, reply_at timestamptz, sends_count int, paid_after boolean, paid_at timestamptz
)
language sql stable set search_path = public as $$
  with latest as (
    select distinct on (phone)
      phone, name, template_name, campaign_name, sent_at, status,
      delivered_at, read_at, replied_at
    from public.whatsapp_campaign_sends
    order by phone, sent_at desc
  ),
  counts as (
    select phone, count(*)::int c from public.whatsapp_campaign_sends group by phone
  ),
  paid as (
    -- أول دفعة زوهو بعد آخر إرسال لعميل يطابق الاسم (تقريبي — الاسم المطبَّع)
    select l.phone,
           min(p.date) filter (where p.date >= l.sent_at::date) as first_paid
    from latest l
    join public.zoho_payments p
      on lower(regexp_replace(coalesce(p.customer_name,''),'\s+','','g'))
       = lower(regexp_replace(coalesce(l.name,''),'\s+','','g'))
     and coalesce(l.name,'') <> ''
    group by l.phone
  )
  select l.phone, l.name, l.template_name, l.campaign_name, l.sent_at, l.status,
         l.delivered_at is not null, l.read_at is not null,
         l.replied_at is not null, l.replied_at,
         coalesce(c.c,1),
         pd.first_paid is not null, pd.first_paid::timestamptz
  from latest l
  left join counts c on c.phone = l.phone
  left join paid  pd on pd.phone = l.phone;
$$;
revoke all on function public.whatsapp_campaign_status() from public;
grant execute on function public.whatsapp_campaign_status() to authenticated;
