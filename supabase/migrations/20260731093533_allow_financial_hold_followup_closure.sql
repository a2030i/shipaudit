create or replace function public.guard_platform_sales_financial_hold()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if exists(
    select 1 from public.v_platform_commercial_routing r
    where r.phone=new.phone and r.financial_hold
  ) then
    if tg_op='UPDATE' and new.sales_stage='disqualified' and new.next_action_at is null then
      return new;
    end if;
    raise exception 'financial_hold';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_platform_sales_financial_hold() from public,anon,authenticated;
grant execute on function public.guard_platform_sales_financial_hold() to service_role;
