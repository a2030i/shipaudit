-- وقت العملية (SiFi يوفّره في الرقم التسلسلي) لترتيب تسلسل العمليات داخل اليوم.
alter table public.bank_transactions add column if not exists txn_at timestamptz;
create index if not exists bank_transactions_txn_at_idx on public.bank_transactions (txn_at);
