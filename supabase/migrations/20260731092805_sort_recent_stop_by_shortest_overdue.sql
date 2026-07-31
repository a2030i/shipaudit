-- The recovery queue is operationally different from the other sales queues:
-- a merchant who has just crossed the five-day threshold must be contacted
-- before one who has already been inactive for months.
--
-- Insert the bucket-specific key ahead of the existing ordering so every
-- other bucket keeps its current due-date and signal-score priority.

do $migration$
declare
  function_signature regprocedure :=
    'public.platform_commercial_pipeline(text,uuid,boolean,text,integer,integer)'::regprocedure;
  current_definition text;
  corrected_definition text;
  sort_expression text :=
    'order by '
    || 'case when p_bucket = ''recent_stop'' then days_since_last end asc nulls last, ';
begin
  select pg_get_functiondef(function_signature)
    into current_definition;

  if current_definition ilike
    '%case when p_bucket = ''recent_stop'' then days_since_last end asc nulls last%'
  then
    return;
  end if;

  corrected_definition := regexp_replace(
    current_definition,
    'order[[:space:]]+by[[:space:]]+',
    sort_expression,
    'i'
  );

  if corrected_definition = current_definition then
    raise exception
      'ORDER BY was not found in platform_commercial_pipeline';
  end if;

  execute corrected_definition;
end;
$migration$;

comment on function public.platform_commercial_pipeline(
  text, uuid, boolean, text, integer, integer
) is
  'Platform commercial pipeline. recent_stop is ordered by the fewest days beyond the five-day threshold; all other buckets retain their existing priority.';
