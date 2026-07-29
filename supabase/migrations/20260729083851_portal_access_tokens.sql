-- بوابة العميل — رابط وصول آمن بدل البحث الحرّ بالجوال (قرار المستخدم:
-- الخيار الثالث + OTP احتياطياً).
--
-- المخاطرة المُعالَجة: `portal_lookup(phone)` تكشف ذمّة أي تاجر لمن يعرف
-- رقمه — بلا إثبات هوية ولا حدّ معدّل. الرابط الموقّع يُرسَل **ضمن رسالة
-- التحصيل** فيصل لصاحبه وحده، ويُثبِت الهوية بالحيازة لا بالمعرفة.
--
-- **لا يُخزَّن الرمز إطلاقاً** — فقط `sha256` منه. تسريب قاعدة البيانات
-- لا يمنح وصولاً، ومقارنة الـhash تتم على الخادم.

create table if not exists public.portal_access_tokens (
  id             uuid primary key default gen_random_uuid(),
  token_hash     text        not null unique,        -- sha256(الرمز) — الرمز نفسه لا يُخزَّن
  purpose        text        not null default 'portal_access'
                 check (purpose in ('portal_access')),
  customer_name  text        not null,               -- مقيَّد بعميل واحد
  store_id       text,
  phone          text,                               -- للتدقيق ولإرسال OTP الاحتياطي
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,               -- 72 ساعة
  used_at        timestamptz,                        -- لمرة واحدة
  revoked_at     timestamptz,
  session_until  timestamptz,                        -- 30 دقيقة بعد أول فتح
  created_by     uuid,
  open_attempts  int         not null default 0
);
create index if not exists ix_portal_tokens_lookup on portal_access_tokens (token_hash);
create index if not exists ix_portal_tokens_customer on portal_access_tokens (customer_name, created_at desc);

-- سجل تدقيق لكل فتح/فشل (المتطلّب: «سجل تدقيق للفتح والفشل»)
create table if not exists public.portal_access_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  token_id   uuid,
  outcome    text not null,      -- opened | expired | used | revoked | not_found | rate_limited
  ip         text,
  user_agent text,
  detail     text
);
create index if not exists ix_portal_log_at on portal_access_log (at desc);
create index if not exists ix_portal_log_ip on portal_access_log (ip, at desc);

-- OTP الاحتياطي: 5 دقائق · محاولات محدودة · مهلة إعادة إرسال · hash فقط
create table if not exists public.portal_otp (
  id          uuid primary key default gen_random_uuid(),
  phone       text        not null,
  code_hash   text        not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  attempts    int         not null default 0,
  consumed_at timestamptz,
  ip          text
);
create index if not exists ix_portal_otp_phone on portal_otp (phone, created_at desc);

-- كل الجداول: RLS مفعّل **بلا سياسات** = لا وصول لأي دور عبر PostgREST.
-- المسّ الوحيد عبر دوال SECURITY DEFINER محدودة أو service_role.
-- (نمط §1.50 `app_secrets` — مقصود هنا لأن لا واجهة تقرأها مباشرة.)
alter table public.portal_access_tokens enable row level security;
alter table public.portal_access_log    enable row level security;
alter table public.portal_otp           enable row level security;
revoke all on public.portal_access_tokens, public.portal_access_log, public.portal_otp from anon, authenticated;

-- قراءة السجل للمدير فقط (شاشة تدقيق لاحقاً)
create policy portal_log_admin_read on public.portal_access_log
  for select to authenticated using ((select is_admin()));
grant select on public.portal_access_log to authenticated;
