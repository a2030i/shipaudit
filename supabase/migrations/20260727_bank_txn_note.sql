-- ملاحظة يدوية على عملية بنكية (صادر/وارد).
alter table public.bank_transactions add column if not exists note text;
