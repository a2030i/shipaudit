-- أسماء «العملاء خارج المنصّة» (leads) لدفعها لجهات هاتف — مصدر مستقل عن المتاجر.
-- الشرط: له محادثة (استلم حملة) + اسم موجود + جوال سعودي + ليس متجراً في المنصّة
-- (المتجر يتكفّل به hatif_contact_profile باسم أدقّ). واحد لكل رقم (أحدث سجل).
-- تستهلكها edge function hatif-lead-names (تكتب الاسم في هاتف إن كان الحالي رقماً).
CREATE OR REPLACE FUNCTION public.hatif_lead_names()
 RETURNS TABLE(phone text, name text, platform text, city text, category text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with latest as (select snapshot_id from merchants order by uploaded_at desc limit 1),
  conv as (select distinct phone from whatsapp_campaign_sends where conversation_id is not null),
  merch as (
    select distinct norm_sa_phone(phone) ph
    from merchants where snapshot_id = (select snapshot_id from latest) and phone is not null
  )
  select distinct on (l.whatsapp_normalized)
    l.whatsapp_normalized as phone,
    trim(l.name) as name,
    l.platform, l.city, l.category
  from crm_leads l
  join conv c on c.phone = l.whatsapp_normalized
  where l.whatsapp_normalized is not null
    and coalesce(trim(l.name), '') <> ''
    and l.whatsapp_normalized ~ '^9665[0-9]{8}$'
    and not exists (select 1 from merch m where m.ph = l.whatsapp_normalized)
  order by l.whatsapp_normalized, l.created_at desc nulls last;
$function$;
