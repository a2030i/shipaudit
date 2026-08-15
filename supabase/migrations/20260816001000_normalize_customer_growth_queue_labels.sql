-- Keep the customer queue readable even when an older SQL client imported
-- Arabic literals with the wrong code page. Unicode escape literals are
-- ASCII-only on disk, so this migration is transport-safe on every client.

create or replace function private.customer_growth_action_queue(
  p_limit integer default 400,
  p_owner text default null,
  p_journey text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null
     or not public.app_has_any_permission(array[
       'collections.view', 'sales.view', 'overview.view', 'crm.view'
     ]) then
    raise exception 'not_allowed';
  end if;

  return (
    with actions as (
      select *
      from public.customer_engagement_next_actions(
        greatest(1, least(coalesce(p_limit, 400), 1000)), p_owner, p_journey
      )
    ), latest_outcome as (
      select distinct on (public.norm_sa_phone(outcome.phone), outcome.reason_code)
        public.norm_sa_phone(outcome.phone) as phone,
        outcome.reason_code,
        outcome.sales_stage,
        outcome.next_action_at,
        outcome.recorded_at
      from public.customer_growth_outcomes outcome
      order by public.norm_sa_phone(outcome.phone), outcome.reason_code, outcome.recorded_at desc
    )
    select coalesce(
      jsonb_agg(
        to_jsonb(queued_action) || jsonb_build_object(
          'reason', case queued_action.reason_code
            when 'hot_reply' then U&'\0648\0635\0644 \0631\062f \0628\0627\0647\062a\0645\0627\0645 \0648\064a\062d\062a\0627\062c \0645\062a\0627\0628\0639\0629 \0628\0634\0631\064a\0629'
            when 'sla' then U&'\0645\062a\0627\0628\0639\0629 \062a\062c\0627\0648\0632\062a \0645\0648\0639\062f\0647\0627 \0623\0648 \0623\0635\0628\062d\062a \0631\0627\0643\062f\0629'
            when 'reply' then U&'\0631\062f \0639\0644\0649 \0627\0644\062d\0645\0644\0629 \0648\0644\0645 \062a\062a\0645 \0645\062a\0627\0628\0639\062a\0647'
            when 'wallet_neg' then U&'\0645\062d\0641\0638\0629 \0627\0644\062f\0641\0639 \0627\0644\0645\0633\0628\0642 \0633\0627\0644\0628\0629'
            when 'debt' then U&'\0639\0644\0649 \0627\0644\0639\0645\064a\0644 \0630\0645\0629 \0645\0641\062a\0648\062d\0629'
            when 'new_ready' then U&'\0627\0644\0639\0645\064a\0644 \062c\0627\0647\0632 \0648\0644\0645 \064a\0646\0641\0630 \0623\0648\0644 \0634\062d\0646\0629'
            when 'new_registered' then U&'\0645\0633\062c\0644 \062d\062f\064a\062b\0627 \0648\0644\0645 \064a\0628\062f\0623 \0627\0644\062a\062c\0647\064a\0632 \0623\0648 \0627\0644\0634\062d\0646'
            when 'stopped_recent' then U&'\062a\0648\0642\0641 \062d\062f\064a\062b\0627 \0639\0646 \0627\0644\0634\062d\0646'
            when 'stopped_long' then U&'\0639\0645\064a\0644 \0639\0627\0644\064a \0627\0644\0642\064a\0645\0629 \0645\062a\0648\0642\0641 \0639\0646 \0627\0644\0634\062d\0646'
            else U&'\062d\0627\0644\0629 \0639\0645\064a\0644 \062a\062d\062a\0627\062c \0645\062a\0627\0628\0639\0629'
          end,
          'action', case queued_action.reason_code
            when 'hot_reply' then U&'\062a\0627\0628\0639 \0631\062f \0627\0644\0639\0645\064a\0644 \0627\0644\0622\0646'
            when 'reply' then U&'\062a\0627\0628\0639 \0631\062f \0627\0644\0639\0645\064a\0644 \0627\0644\0622\0646'
            when 'sla' then U&'\0646\0641\0630 \0645\062a\0627\0628\0639\0629 \0627\0644\0645\0648\0638\0641 \0627\0644\0622\0646'
            when 'wallet_neg' then U&'\062d\0635\0644 \0631\0635\064a\062f \0627\0644\0645\062d\0641\0638\0629'
            when 'debt' then U&'\062a\0627\0628\0639 \0627\0644\062a\062d\0635\064a\0644 \062d\0633\0628 \0643\0634\0641 \0627\0644\0639\0645\064a\0644'
            when 'new_ready' then U&'\0633\0627\0639\062f\0647 \0639\0644\0649 \062a\0646\0641\064a\0630 \0623\0648\0644 \0634\062d\0646\0629'
            when 'new_registered' then U&'\0633\0627\0639\062f\0647 \0639\0644\0649 \0625\0643\0645\0627\0644 \0627\0644\0628\064a\0627\0646\0627\062a \0648\0631\0628\0637 \0627\0644\0645\062a\062c\0631'
            when 'stopped_recent' then U&'\0627\0641\0647\0645 \0633\0628\0628 \0627\0644\062a\0648\0642\0641 \0648\0623\0639\062f \062a\0646\0634\064a\0637\0647'
            when 'stopped_long' then U&'\0631\0627\062c\0639 \0633\0628\0628 \0627\0644\0641\0642\062f \062b\0645 \0646\0641\0630 \0645\062d\0627\0648\0644\0629 \0627\0633\062a\0639\0627\062f\0629'
            else U&'\0631\0627\062c\0639 \062d\0627\0644\0629 \0627\0644\0639\0645\064a\0644 \0648\062d\062f\062f \0627\0644\0625\062c\0631\0627\0621 \0627\0644\062a\0627\0644\064a'
          end,
          'guard_reason', case queued_action.guard_code
            when 'ready' then U&'\062c\0627\0647\0632 \0644\0644\0645\0631\0627\062c\0639\0629'
            when 'invalid_phone' then U&'\0631\0642\0645 \0627\0644\0647\0627\062a\0641 \063a\064a\0631 \0635\0627\0644\062d'
            when 'blocked' then U&'\0627\0644\0631\0642\0645 \0641\064a \0642\0627\0626\0645\0629 \0627\0644\062d\0638\0631'
            when 'human_followup' then U&'\0645\062a\0627\0628\0639\0629 \0628\0634\0631\064a\0629 \0648\0644\064a\0633\062a \0631\0633\0627\0644\0629 \0642\0627\0644\0628 \062c\062f\064a\062f\0629'
            when 'human_call' then U&'\0641\0631\0635\0629 \0639\0627\0644\064a\0629 \0627\0644\0642\064a\0645\0629 \0648\062a\062d\062a\0627\062c \0627\062a\0635\0627\0644\0627 \0623\0648\0644\0627'
            when 'owner_followup' then U&'\062a\0648\062c\062f \0645\062a\0627\0628\0639\0629 \0645\0648\0638\0641 \0623\0648 \062a\0648\0627\0635\0644 \062d\062f\064a\062b'
            when 'recent_campaign' then U&'\0623\0631\0633\0644\062a \0644\0647 \062d\0645\0644\0629 \062e\0644\0627\0644 \0622\062e\0631 7 \0623\064a\0627\0645'
            when 'recent_call' then U&'\062c\0631\0649 \0627\062a\0635\0627\0644 \0639\0628\0631 \0647\0627\062a\0641 \062e\0644\0627\0644 \0622\062e\0631 3 \0623\064a\0627\0645'
            when 'stale_source' then U&'\0644\0642\0637\0629 \0627\0644\0645\062a\0627\062c\0631 \0623\0642\062f\0645 \0645\0646 72 \0633\0627\0639\0629'
            else U&'\062a\062d\062a\0627\062c \0645\0631\0627\062c\0639\0629'
          end
        )
        order by queued_action.priority desc, queued_action.amount desc nulls last
      ),
      '[]'::jsonb
    )
    from actions queued_action
    left join latest_outcome outcome
      on outcome.phone = public.norm_sa_phone(queued_action.phone)
     and outcome.reason_code = queued_action.reason_code
    where outcome.phone is null
       or (
         outcome.sales_stage not in ('won', 'lost')
         and (outcome.next_action_at is null or outcome.next_action_at <= now())
       )
       or outcome.recorded_at < now() - interval '90 days'
  );
end;
$function$;

revoke all on function private.customer_growth_action_queue(integer, text, text) from public, anon;
grant execute on function private.customer_growth_action_queue(integer, text, text) to authenticated, service_role;

comment on function private.customer_growth_action_queue(integer, text, text) is
  'Protected customer action queue with transport-safe Arabic labels; never sends messages.';
