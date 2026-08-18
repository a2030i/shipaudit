-- وسم حدثي: منتج (تريجرات) يضع الأرقام المتأثّرة في قائمة، مستهلك خفيف
-- (hatif-retag-runner، كل 5د) يطبّقها على هاتف. الكرون الكامل (20د) يبقى شبكة أمان
-- للتاقات الزمنية (متأخر سداد/متوقف/جديد — لا حدث لها، الساعة فقط).

create table if not exists public.hatif_retag_dirty (
  phone text primary key,
  reason text,
  queued_at timestamptz not null default now()
);
alter table public.hatif_retag_dirty enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='hatif_retag_dirty' and policyname='hatif_retag_dirty_sel')
    then create policy hatif_retag_dirty_sel on public.hatif_retag_dirty for select to authenticated using (true); end if;
  if not exists (select 1 from pg_policies where tablename='hatif_retag_dirty' and policyname='hatif_retag_dirty_ins')
    then create policy hatif_retag_dirty_ins on public.hatif_retag_dirty for insert to authenticated with check (true); end if;
end $$;

-- تريجر زوهو: تغيّر رصيد فاتورة يمسّ تاق المديونية → ضع هاتف العميل في القائمة.
create or replace function public.trg_zoho_invoice_retag() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare oldbal numeric := case when TG_OP='UPDATE' then coalesce(old.balance,0) else 0 end;
begin
  if coalesce(new.balance,0) <= 0.5 and oldbal <= 0.5 then return new; end if;
  insert into public.hatif_retag_dirty (phone, reason)
  select distinct public.norm_sa_phone(m.phone), 'zoho'
  from public.customer_merchant_links l
  join public.merchants m on m.store_id = l.store_id and m.snapshot_id = (select max(snapshot_id) from public.merchants)
  where l.customer_name = new.customer_name and m.phone is not null
    and public.norm_sa_phone(m.phone) ~ '^9665[0-9]{8}$'
  on conflict (phone) do update set queued_at = now(), reason = excluded.reason;
  return new;
end $$;
drop trigger if exists zoho_invoice_retag on public.zoho_invoices;
create trigger zoho_invoice_retag after insert or update on public.zoho_invoices
  for each row execute function public.trg_zoho_invoice_retag();

-- تريجر بلاك لست: إضافة رقم → أعد وسمه فوراً
create or replace function public.trg_blocklist_retag() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.norm_sa_phone(new.phone) ~ '^9665[0-9]{8}$' then
    insert into public.hatif_retag_dirty (phone, reason)
    values (public.norm_sa_phone(new.phone), 'blocklist')
    on conflict (phone) do update set queued_at = now(), reason = excluded.reason;
  end if;
  return new;
end $$;
drop trigger if exists blocklist_retag on public.campaign_phone_blocklist;
create trigger blocklist_retag after insert on public.campaign_phone_blocklist
  for each row execute function public.trg_blocklist_retag();

-- محادثة جديدة (رقم استلم حملة) = مُنتِج أساسي: يستحقّ التاق فور أول محادثة.
create or replace function public.trg_wcs_retag() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.conversation_id is not null and new.phone ~ '^9665[0-9]{8}$' then
    insert into public.hatif_retag_dirty (phone, reason)
    values (new.phone, 'new_conversation')
    on conflict (phone) do update set queued_at = now(), reason = excluded.reason;
  end if;
  return new;
end $$;
drop trigger if exists wcs_retag on public.whatsapp_campaign_sends;
create trigger wcs_retag after insert on public.whatsapp_campaign_sends
  for each row execute function public.trg_wcs_retag();

-- RPC: إطلاق مزامنة كاملة فورية (يُستدعى بعد رفع متاجر/leads) — بمفتاح الكرون سيرفرياً
create or replace function public.trigger_tag_sync() returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare k text;
begin
  select cron_key into k from public.zoho_auth where id = 1;
  if k is null then return; end if;
  perform net.http_post(
    url := 'https://pubtkfwmznfmffavyzsy.supabase.co/functions/v1/hatif-tag-sync',
    body := '{"limit":120}'::jsonb,
    headers := jsonb_build_object('Content-Type','application/json','X-Cron-Key', k));
end $$;
grant execute on function public.trigger_tag_sync() to authenticated;

-- كرون المستهلك الخفيف كل 5 دقائق
select cron.schedule('hatif-retag-runner', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://pubtkfwmznfmffavyzsy.supabase.co/functions/v1/hatif-retag-runner',
    headers := jsonb_build_object('Content-Type','application/json','X-Cron-Key',(select cron_key from public.zoho_auth where id=1)),
    body := '{"maxWrites":80}'::jsonb);
$cron$);
