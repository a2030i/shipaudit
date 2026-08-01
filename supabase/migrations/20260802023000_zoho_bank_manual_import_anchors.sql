create table if not exists public.zoho_bank_import_anchors (
  zoho_account_id text primary key,
  reference_number text not null,
  anchor_date date,
  local_transaction_id uuid references public.bank_transactions(id) on delete set null,
  reason text,
  set_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.zoho_bank_import_anchors enable row level security;
revoke all on public.zoho_bank_import_anchors from anon, authenticated;

insert into public.zoho_bank_import_anchors
  (zoho_account_id, reference_number, anchor_date, local_transaction_id, reason)
values
  ('7589996000000105051', 'FT262054BYN8', '2026-07-24', 'ed82f5a6-b892-43b4-8232-d5b18921b31d',
   'اعتمدها المدير كنقطة بداية لبنك الإنماء بعد اختبار قبول زوهو للتكرار')
on conflict (zoho_account_id) do update set
  reference_number = excluded.reference_number,
  anchor_date = excluded.anchor_date,
  local_transaction_id = excluded.local_transaction_id,
  reason = excluded.reason,
  updated_at = now();

comment on table public.zoho_bank_import_anchors is
  'مرساة يدوية معتمدة لاستيراد البنك؛ تتقدم على آخر كشف أو أحدث عملية في Zoho.';
