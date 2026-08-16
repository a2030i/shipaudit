create table if not exists public.hudhud_api_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  ip_hash text not null check (length(ip_hash) = 64),
  action text not null check (action in ('reverse','shortcode','geocode','categories','places','place_detail','directions','matrix')),
  ok boolean,
  status_code integer,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  error_code text
);

alter table public.hudhud_api_events enable row level security;
revoke all on table public.hudhud_api_events from public, anon, authenticated;
grant select, insert, update, delete on table public.hudhud_api_events to service_role;
grant usage, select on sequence public.hudhud_api_events_id_seq to service_role;
create index if not exists hudhud_api_events_rate_idx on public.hudhud_api_events (ip_hash, created_at desc);
create index if not exists hudhud_api_events_created_idx on public.hudhud_api_events (created_at desc);

create or replace function public.start_hudhud_api_request(
  p_ip_hash text,
  p_action text,
  p_limit integer default 60,
  p_window_seconds integer default 60
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_id bigint;
begin
  if length(p_ip_hash) <> 64 or p_action not in ('reverse','shortcode','geocode','categories','places','place_detail','directions','matrix') then
    raise exception 'invalid request metadata';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_ip_hash));
  if (select count(*) from public.hudhud_api_events where ip_hash=p_ip_hash and created_at > now() - make_interval(secs => greatest(p_window_seconds,1))) >= greatest(p_limit,1) then
    return 0;
  end if;
  insert into public.hudhud_api_events(ip_hash,action) values(p_ip_hash,p_action) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.start_hudhud_api_request(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.start_hudhud_api_request(text,text,integer,integer) to service_role;
comment on table public.hudhud_api_events is 'Privacy-safe Hudhud API request telemetry. Never stores coordinates, shortcodes, addresses, or raw IPs.';
