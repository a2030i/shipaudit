-- CRM إعادة الاستهداف — المرحلة 1 (أساس البيانات).
-- الأعمدة الأربعة من stores.xlsx التي مهّد لها البارسر/اللودر (مع fallback):
-- حالة الملف · التوثيق · مسجل ضريبة · بيانات زاتكا. تُلتقط عند الرفع القادم.
alter table public.merchants
  add column if not exists profile_status      text,
  add column if not exists vat_registered      boolean,
  add column if not exists zatca_completed     boolean,
  add column if not exists verification_status text;
