-- Financial truth guards:
-- 1) the expected operating-bank count is derived from explicit internal bank
--    sources/links instead of the historical hard-coded value 3;
-- 2) Moyassar and clearing accounts are not presented as missing banks.
-- This migration changes read-model semantics only. It does not alter balances,
-- transactions, journals, invoices, or any Zoho record.

do $migration$
declare
  v_definition text;
  v_original text;
begin
  select pg_get_functiondef('public.zoho_financial_control_dashboard()'::regprocedure)
    into v_definition;
  v_original := v_definition;

  v_definition := replace(
    v_definition,
    $old$when b.account_name like 'خزينة%' then 'operating_treasury'
          else 'unclassified'$old$,
    $new$when b.account_name like 'خزينة%' then 'operating_treasury'
          when b.account_name ~* '(moyassar|ميسر)' then 'payment_gateway'
          when b.account_name ~* '(أموال غير مودعة|undeposited funds|حساب تسوية المتاجر|merchant settlement)' then 'clearing'
          else 'unclassified'$new$
  );

  v_definition := replace(
    v_definition,
    $old$'expected_bank_count', 3,$old$,
    $new$'expected_bank_count', greatest(
          count(*) filter (where l.link_kind = 'bank'),
          (select count(*) from (
            select distinct nullif(btrim(bank), '') as bank from public.bank_balance_log
            union
            select distinct nullif(btrim(bank), '') as bank from public.bank_statement_summaries
          ) expected where expected.bank is not null)
        ),$new$
  );

  v_definition := replace(
    v_definition,
    $old$'unclassified_count', count(*) filter (where l.id is null and b.account_name not like 'خزينة%'),$old$,
    $new$'unclassified_count', count(*) filter (
          where l.id is null
            and b.account_name not like 'خزينة%'
            and b.account_name !~* '(moyassar|ميسر)'
            and b.account_name !~* '(أموال غير مودعة|undeposited funds|حساب تسوية المتاجر|merchant settlement)'
        ),$new$
  );

  if v_definition = v_original
     or v_definition like '%' || $needle$'expected_bank_count', 3,$needle$ || '%' then
    raise exception 'zoho_financial_control_dashboard patch did not match expected definition';
  end if;

  execute v_definition;
end;
$migration$;

comment on function public.zoho_financial_control_dashboard() is
  'Financial read model. Expected banks come from explicit internal sources/links; gateways and clearing accounts are not banks.';
