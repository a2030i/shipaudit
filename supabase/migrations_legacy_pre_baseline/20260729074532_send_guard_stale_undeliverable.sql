-- حارس الإرسال يوسَّع (بلا تغيير دلالة «بلا واتساب»).
-- المقيس: 35 رقماً أُعيد الإرسال لهم بعد فشل نهائي (27–28 يوليو) رغم حارس
-- v14 — لأن `v_no_whatsapp` تستثني كل رقم **سبق أن وصلته** رسالة يوماً ما.
-- وهذا صحيح كـ**خاصية** («لديه واتساب») لكنه خاطئ كـ**قرار إرسال**: الرقم
-- الذي فشل مرتين متتاليتين ولم يستقبل شيئاً منذ أول فشل = رقم ميت عملياً،
-- وكل محاولة إضافية تُنقص تصنيف جودة رقمنا لدى ميتا بلا أي عائد.
--
-- الفصل مقصود: `v_no_whatsapp` تبقى **خاصية العميل** (تُعرَض في هاتف)،
-- و`no_whatsapp_phones()` هي **قرار الإرسال** وحدها.
create or replace function public.no_whatsapp_phones()
 returns table(phone text) language sql stable security definer set search_path to 'public'
as $function$
  select phone from public.v_no_whatsapp
  union
  select phone from public.campaign_phone_blocklist
  union
  -- فشل «غير قابل للتسليم» مرتين فأكثر، وبلا أي تسليم/قراءة/ردّ منذ أول فشل
  select s.phone
  from whatsapp_campaign_sends s
  where s.error_reason ilike '%undeliverable%'
  group by s.phone
  having count(*) >= 2
     and not exists (
       select 1 from whatsapp_campaign_sends d
       where d.phone = s.phone
         and (d.delivered_at is not null or d.read_at is not null or d.replied_at is not null)
         and d.sent_at > min(s.sent_at)
     );
$function$;
