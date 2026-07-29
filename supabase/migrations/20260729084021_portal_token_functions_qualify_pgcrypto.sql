-- دوال الرمز — **كلها service_role فقط** (تُستدعى من الدالة الطرفية).
-- لا شيء منها متاح لـanon: الزائر لا يملك إلا تمرير الرمز للدالة الطرفية.
--
-- ⚠️ pgcrypto مثبَّت في مخطط `extensions` لا `public`، و`search_path` المقيَّد
-- لدوال SECURITY DEFINER (وهو مقصود أمنياً) لا يراه.
-- **الحل: تأهيل الاستدعاء صراحةً `extensions.digest(...)`** — لا توسيع
-- الـsearch_path، فتوسيعه في دالة DEFINER يفتح باب حقن المخطط.
--
-- (هذه المهاجرة تحلّ محلّ 20260729083932_portal_token_functions التي فشلت
--  على `gen_random_bytes` غير المؤهَّل.)

-- (١) إصدار رمز لعميل — يُستدعى عند بناء رسالة التحصيل.
--     يُرجِع الرمز **مرّة واحدة فقط** (لا يُخزَّن، فلا يمكن استرجاعه لاحقاً).
create or replace function public.portal_issue_token(
  p_customer text, p_store_id text default null, p_phone text default null,
  p_hours int default 72, p_by uuid default null)
 returns table(token text, expires_at timestamptz)
 language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare v_token text; v_hash text; v_exp timestamptz;
begin
  if coalesce(trim(p_customer),'') = '' then
    raise exception 'customer مطلوب';
  end if;
  -- 32 بايت عشوائية → base64url. لا يحتوي جوالاً ولا مديونية ولا معرّف عميل.
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  v_hash  := encode(extensions.digest(v_token, 'sha256'), 'hex');
  v_exp   := now() + make_interval(hours => greatest(least(p_hours, 168), 1));
  insert into portal_access_tokens (token_hash, customer_name, store_id, phone, expires_at, created_by)
  values (v_hash, p_customer, p_store_id, nullif(p_phone,''), v_exp, p_by);
  return query select v_token, v_exp;
end $$;

-- (٢) استهلاك الرمز — يتحقّق ويفتح جلسة 30 دقيقة ويُلغي الرمز (مرّة واحدة).
--     **كل نتيجة تُسجَّل** في سجل التدقيق، وحدّ المعدّل بالـIP قبل أي شيء.
create or replace function public.portal_redeem_token(
  p_token text, p_ip text default null, p_ua text default null, p_session_min int default 30)
 returns jsonb
 language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare r record; v_hash text; v_recent int; v_sess timestamptz;
begin
  if p_ip is not null then
    select count(*) into v_recent from portal_access_log
    where ip = p_ip and at > now() - interval '10 minutes';
    if v_recent >= 20 then
      insert into portal_access_log (outcome, ip, user_agent, detail)
      values ('rate_limited', p_ip, p_ua, 'تجاوز 20 محاولة/10 دقائق');
      return jsonb_build_object('ok', false, 'reason', 'rate_limited');
    end if;
  end if;

  v_hash := encode(extensions.digest(coalesce(p_token,''), 'sha256'), 'hex');
  select * into r from portal_access_tokens where token_hash = v_hash;

  if r.id is null then
    insert into portal_access_log (outcome, ip, user_agent) values ('not_found', p_ip, p_ua);
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  update portal_access_tokens set open_attempts = open_attempts + 1 where id = r.id;

  if r.revoked_at is not null then
    insert into portal_access_log (token_id, outcome, ip, user_agent) values (r.id, 'revoked', p_ip, p_ua);
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;
  if r.expires_at < now() then
    insert into portal_access_log (token_id, outcome, ip, user_agent) values (r.id, 'expired', p_ip, p_ua);
    return jsonb_build_object('ok', false, 'reason', 'expired', 'phone', r.phone);
  end if;
  -- مرّة واحدة: يبقى صالحاً داخل نافذة الجلسة فقط (تحديث الصفحة لا يقطعها)
  if r.used_at is not null and coalesce(r.session_until, r.used_at) < now() then
    insert into portal_access_log (token_id, outcome, ip, user_agent) values (r.id, 'used', p_ip, p_ua);
    return jsonb_build_object('ok', false, 'reason', 'used', 'phone', r.phone);
  end if;

  update portal_access_tokens
    set used_at = coalesce(used_at, now()),
        session_until = coalesce(session_until, now() + make_interval(mins => greatest(least(p_session_min,120),5)))
  where id = r.id
  returning session_until into v_sess;

  insert into portal_access_log (token_id, outcome, ip, user_agent) values (r.id, 'opened', p_ip, p_ua);
  return jsonb_build_object(
    'ok', true, 'customer_name', r.customer_name, 'store_id', r.store_id,
    'phone', r.phone, 'session_until', v_sess);
end $$;

-- (٣) بيانات البوابة بالعميل مباشرةً (لا بالجوال) — تُستدعى بعد التحقّق فقط.
create or replace function public.portal_data_for_customer(p_customer text)
 returns jsonb language sql stable security definer set search_path to 'public','pg_temp'
as $$
  select jsonb_build_object(
    'customer_name', ar.contact_name,
    'total_due',     round(ar.total_due::numeric, 2),
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'number', i.invoice_number, 'date', i.date, 'amount', round(i.balance::numeric,2), 'id', i.zoho_id)
        order by i.date)
      from zoho_invoices i where i.customer_name = ar.contact_name and i.balance > 0.5), '[]'::jsonb)
  )
  from customer_ar ar where ar.contact_name = p_customer;
$$;

revoke execute on function public.portal_issue_token(text,text,text,int,uuid) from public, anon, authenticated;
revoke execute on function public.portal_redeem_token(text,text,text,int)     from public, anon, authenticated;
revoke execute on function public.portal_data_for_customer(text)              from public, anon, authenticated;
grant  execute on function public.portal_issue_token(text,text,text,int,uuid) to service_role;
grant  execute on function public.portal_redeem_token(text,text,text,int)     to service_role;
grant  execute on function public.portal_data_for_customer(text)              to service_role;
