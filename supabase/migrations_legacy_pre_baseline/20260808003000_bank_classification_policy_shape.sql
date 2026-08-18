-- Keep the read policy singular so Postgres does not evaluate two permissive
-- SELECT policies for every bank rule/match row. Write permissions remain
-- explicit and action-scoped.
drop policy if exists bank_rules_write on public.bank_classification_rules;
drop policy if exists bank_rules_insert on public.bank_classification_rules;
drop policy if exists bank_rules_update on public.bank_classification_rules;
drop policy if exists bank_rules_delete on public.bank_classification_rules;
create policy bank_rules_insert on public.bank_classification_rules for insert to authenticated
  with check (public.crm_has_permission('bank.reconcile'));
create policy bank_rules_update on public.bank_classification_rules for update to authenticated
  using (public.crm_has_permission('bank.reconcile')) with check (public.crm_has_permission('bank.reconcile'));
create policy bank_rules_delete on public.bank_classification_rules for delete to authenticated
  using (public.crm_has_permission('bank.reconcile'));

drop policy if exists bank_matches_write on public.bank_transaction_matches;
drop policy if exists bank_matches_insert on public.bank_transaction_matches;
drop policy if exists bank_matches_update on public.bank_transaction_matches;
drop policy if exists bank_matches_delete on public.bank_transaction_matches;
create policy bank_matches_insert on public.bank_transaction_matches for insert to authenticated
  with check (public.crm_has_permission('bank.reconcile'));
create policy bank_matches_update on public.bank_transaction_matches for update to authenticated
  using (public.crm_has_permission('bank.reconcile')) with check (public.crm_has_permission('bank.reconcile'));
create policy bank_matches_delete on public.bank_transaction_matches for delete to authenticated
  using (public.crm_has_permission('bank.reconcile'));
