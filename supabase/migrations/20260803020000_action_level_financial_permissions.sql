-- Action-level permission hardening for bank statements and payment matching.
-- UI checks improve clarity; these policies/triggers are the enforcement layer.

alter table public.bank_transactions enable row level security;

drop policy if exists bank_transactions_all on public.bank_transactions;
drop policy if exists bank_transactions_sel on public.bank_transactions;
drop policy if exists bank_transactions_ins_mw on public.bank_transactions;
drop policy if exists bank_transactions_upd_mw on public.bank_transactions;
drop policy if exists bank_transactions_del_mw on public.bank_transactions;

create policy bank_transactions_select
  on public.bank_transactions for select to authenticated
  using (public.crm_has_permission('bank.view'));

create policy bank_transactions_insert
  on public.bank_transactions for insert to authenticated
  with check (public.crm_has_permission('bank.upload_statement'));

create policy bank_transactions_update
  on public.bank_transactions for update to authenticated
  using (
    public.crm_has_permission('bank.upload_statement')
    or public.crm_has_permission('bank.edit_note')
  )
  with check (
    public.crm_has_permission('bank.upload_statement')
    or public.crm_has_permission('bank.edit_note')
  );

create policy bank_transactions_delete
  on public.bank_transactions for delete to authenticated
  using (public.crm_has_permission('bank.delete_transaction'));

create or replace function public.enforce_bank_transaction_action_permission()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not public.crm_has_permission('bank.upload_statement') then
      raise exception 'not_allowed:bank.upload_statement';
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if not public.crm_has_permission('bank.delete_transaction') then
      raise exception 'not_allowed:bank.delete_transaction';
    end if;
    return old;
  end if;

  -- A note editor may change only note (+ the technical updated_at column).
  if (to_jsonb(new) - 'note' - 'updated_at') = (to_jsonb(old) - 'note' - 'updated_at') then
    if not public.crm_has_permission('bank.edit_note')
       and not public.crm_has_permission('bank.upload_statement') then
      raise exception 'not_allowed:bank.edit_note';
    end if;
  elsif not public.crm_has_permission('bank.upload_statement') then
    raise exception 'not_allowed:bank.upload_statement';
  end if;
  return new;
end;
$$;

drop trigger if exists bank_transaction_action_permission on public.bank_transactions;
create trigger bank_transaction_action_permission
before insert or update or delete on public.bank_transactions
for each row execute function public.enforce_bank_transaction_action_permission();

alter table public.bank_statement_summaries enable row level security;
drop policy if exists bss_all on public.bank_statement_summaries;
drop policy if exists bank_statement_summaries_select on public.bank_statement_summaries;
drop policy if exists bank_statement_summaries_write on public.bank_statement_summaries;

create policy bank_statement_summaries_select
  on public.bank_statement_summaries for select to authenticated
  using (public.crm_has_permission('bank.view'));

create policy bank_statement_summaries_insert
  on public.bank_statement_summaries for insert to authenticated
  with check (public.crm_has_permission('bank.upload_statement'));

create policy bank_statement_summaries_update
  on public.bank_statement_summaries for update to authenticated
  using (public.crm_has_permission('bank.upload_statement'))
  with check (public.crm_has_permission('bank.upload_statement'));

create or replace function public.enforce_carrier_payment_action_permission()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if new.status is distinct from old.status
     or new.paid_at is distinct from old.paid_at
     or new.payment_ref is distinct from old.payment_ref then
    if not public.crm_has_permission('payments.allocate')
       and not public.crm_has_permission('bank.reconcile') then
      raise exception 'not_allowed:bank.reconcile_or_payments.allocate';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists carrier_payment_action_permission on public.carrier_operations;
create trigger carrier_payment_action_permission
before update on public.carrier_operations
for each row execute function public.enforce_carrier_payment_action_permission();

revoke all on function public.enforce_bank_transaction_action_permission() from public, anon;
revoke all on function public.enforce_carrier_payment_action_permission() from public, anon;
