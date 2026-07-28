-- كل إدخال يدوي أصبح تابعاً لبنك محدد.
-- القيمة الافتراضية تحفظ معنى السجلات القديمة التي سبقت دعم تعدد البنوك.
alter table public.bank_balance_log
  add column if not exists bank text not null default 'بنك الإنماء';

create index if not exists bank_balance_log_bank_recorded_at_idx
  on public.bank_balance_log (bank, recorded_at desc);

comment on column public.bank_balance_log.bank is
  'اسم البنك/الحساب الذي يخصه الرصيد اليدوي؛ أحدث مصدر لكل بنك يدخل في إجمالي السيولة المسجلة.';
