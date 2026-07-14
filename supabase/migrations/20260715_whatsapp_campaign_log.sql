-- سجل الحملات المرجعي — كل رسالة مع اسم المُرسِل (من profiles عبر sent_by) + الحالة.
-- p_phone لتاريخ حملات عميل واحد. sent_by صار uuid (hatif-send v3)؛ القيم القديمة
-- 'admin'/'user' تُعرَّب في coalesce.
create or replace function public.whatsapp_campaign_log(p_phone text default null, p_limit int default 300)
returns table (
  id bigint, phone text, name text, template_name text, campaign_name text, campaign_bucket text,
  amount numeric, status text, sent_at timestamptz, sent_by_name text,
  delivered_at timestamptz, read_at timestamptz, replied_at timestamptz, reply_body text, error_reason text
)
language sql stable set search_path = public as $$
  select s.id, s.phone, s.name, s.template_name, s.campaign_name, s.campaign_bucket,
         s.amount, s.status, s.sent_at,
         coalesce(pr.name,
           case when s.sent_by = 'admin' then 'مدير' when s.sent_by = 'user' then 'موظف'
                when s.sent_by is null then '—' else s.sent_by end) as sent_by_name,
         s.delivered_at, s.read_at, s.replied_at, s.reply_body, s.error_reason
  from public.whatsapp_campaign_sends s
  left join public.profiles pr on pr.id::text = s.sent_by
  where p_phone is null or s.phone = p_phone
  order by s.sent_at desc
  limit greatest(1, least(coalesce(p_limit, 300), 1000));
$$;
revoke all on function public.whatsapp_campaign_log(text, int) from public;
grant execute on function public.whatsapp_campaign_log(text, int) to authenticated;
