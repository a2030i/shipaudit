-- دعم البنوك المتعددة (المستخدم: الإنماء + SiFi + بنك آخر قادم). عمود «bank» على
-- العمليات والملخّصات؛ الفرادة تشمل البنك فلا تتصادم مراجع بنكين. الموجود = الإنماء.
alter table public.bank_transactions add column if not exists bank text not null default 'بنك الإنماء';
alter table public.bank_statement_summaries add column if not exists bank text not null default 'بنك الإنماء';
update public.bank_transactions set bank = 'بنك الإنماء' where bank = 'alinma';
update public.bank_statement_summaries set bank = 'بنك الإنماء' where bank = 'alinma';
drop index if exists public.bank_transactions_dedup_key_uidx;
create unique index if not exists bank_transactions_bank_dedup_uidx on public.bank_transactions (bank, dedup_key);
alter table public.bank_statement_summaries drop constraint if exists bank_statement_summaries_period_from_period_to_key;
create unique index if not exists bank_statement_summaries_bank_period_uidx on public.bank_statement_summaries (bank, period_from, period_to);
