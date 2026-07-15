-- تطبيع رقم سعودي (يطابق normalizeSaudiPhone في JS و norm في hatif-send).
create or replace function public.norm_sa_phone(raw text)
returns text language plpgsql immutable as $$
declare x text;
begin
  x := regexp_replace(coalesce(raw, ''), '\D', '', 'g');
  if x = '' then return null; end if;
  if left(x, 2) = '00' then x := substr(x, 3); end if;
  if left(x, 3) = '966' then
    x := '966' || ltrim(substr(x, 4), '0');
  elsif length(x) = 10 and left(x, 2) = '05' then
    x := '966' || substr(x, 2);
  elsif length(x) = 9 and left(x, 1) = '5' then
    x := '966' || x;
  end if;
  return x;
end $$;
grant execute on function public.norm_sa_phone(text) to authenticated;

-- حالة مزامنة جهات هاتف: contact_id (يلغي البحث لاحقاً) + بصمة الحمولة (لا نرسل إلا المتغيّر).
create table if not exists public.hatif_contact_sync (
  phone        text primary key,
  contact_id   text,
  payload_hash text,
  synced_at    timestamptz not null default now(),
  error        text
);
alter table public.hatif_contact_sync enable row level security;
drop policy if exists hcs_read on public.hatif_contact_sync;
create policy hcs_read on public.hatif_contact_sync for select to authenticated using (true);

-- ملاحظة: hatif_contact_labels() v2 (الهاتف مطبَّع + دمج التصادمات + استبعاد المشوّه)
-- في 20260715_hatif_contact_labels.sql — حُدِّث هناك.
