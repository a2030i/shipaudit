-- Persist the exact carrier receipt slot covered by a remittance upload.
-- The accounting-cycle event log remains useful history, but cycle
-- completion must also be recoverable from the financial source row itself.
alter table public.cod_settlement
  add column if not exists schedule_slot date;

comment on column public.cod_settlement.schedule_slot is
  'Scheduled carrier remittance receipt covered by this upload; null for non-scheduled and Lamha/out rows.';

alter table public.cod_settlement
  drop constraint if exists cod_settlement_schedule_slot_in_check;

alter table public.cod_settlement
  add constraint cod_settlement_schedule_slot_in_check
  check (schedule_slot is null or direction = 'in');

create index if not exists cod_settlement_schedule_slot_in_idx
  on public.cod_settlement (schedule_slot, carrier_id, upload_id)
  where direction = 'in' and schedule_slot is not null;
