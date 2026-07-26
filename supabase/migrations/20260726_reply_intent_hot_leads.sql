-- #3 ذكاء النصوص: مصنّف نية الردّ + إشارة «ردّ حارّ» في next_best_actions.
-- reply_intent(t): يستبعد ردّادات المتاجر الآلية ثم يصنّف (interested/wants_call/
-- price/not_interested). الردّ المهتمّ يُرفَع لأعلى «الفعل التالي» (أولوية 108).
-- next_best_actions أُعيد إنشاؤها بفرع hot_reply؛ التعريف الكامل مطبَّق عبر MCP.
create or replace function public.reply_intent(t text)
returns text language sql immutable set search_path = public, pg_temp as $fn$
  select case
    when t is null or length(btrim(t)) < 2 then null
    when t ~ 'شكر.{0,4}(لك )?على تواصلك|شكر.{0,4}لتواصلك|يسعدنا خدمتك|سنرد على رسالتك|المحل مغلق|الطلب (عن طريق |ب)?الموقع|اختار.{0,4}الرقم المناسب|الاسعار.{0,6}الموقع|زيارة الموقع' then null
    when t ~ 'اتصال|اتصلوا|كلموني|كلمني|رقمكم|تتصلون|أتصل|اتصلو' then 'wants_call'
    when t ~ 'غالي|مرتفع.{0,8}سعر|أرخص|ارخص|تخفيض|خصم|السعر.{0,8}عالي' then 'price'
    when t ~ 'ما ?بي|ما ?اريد|مو مهتم|مب مهتم|لست مهتم|توقفت|مسكر|مغلق نهائي|لا شكرا|not interested' then 'not_interested'
    when t ~ 'تفاصيل|معلومات|كيف|الاسعار|الأسعار|السعر|الوزن|الشحن|ممكن|كم |وش |ايش|أكثر|اكثر|أبغى|ابغى|أريد|اريد' then 'interested'
    else null
  end;
$fn$;
