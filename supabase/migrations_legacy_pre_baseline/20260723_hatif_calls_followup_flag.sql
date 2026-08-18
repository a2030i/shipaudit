-- البند 9: المكالمة الواردة الحارّة → متابعة/مهمة. عمود dedup (حجز ذرّي مرة واحدة
-- لكل مكالمة) كي لا تُنشئ webhook مكرّرة مهمتين.
alter table public.hatif_calls add column if not exists followup_created boolean not null default false;
