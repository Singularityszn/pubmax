begin;

create table public.price_alert_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  area text not null check (length(area) between 1 and 80),
  threshold_pence integer not null check (threshold_pence in (400, 450, 500, 550, 600)),
  token text not null unique check (length(token) between 1 and 2048),
  enabled_at timestamptz not null default now()
);
create index price_alert_preferences_area_price_idx on public.price_alert_preferences (area, threshold_pence);

create table public.price_alert_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null check (length(event_id) between 1 and 100),
  area text not null,
  alert_day date not null,
  primary key (user_id, event_id),
  unique (user_id, area, alert_day)
);
create index price_alert_claims_event_idx on public.price_alert_claims (event_id);

alter table public.price_alert_preferences enable row level security;
alter table public.price_alert_claims enable row level security;
revoke all on public.price_alert_preferences, public.price_alert_claims from public, anon, authenticated;
grant all on public.price_alert_preferences, public.price_alert_claims to service_role;

create function public.price_alert_bind(p_user_id uuid, p_area text, p_threshold_pence integer, p_token text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_token, 0));
  delete from public.price_alert_preferences where token = p_token and user_id <> p_user_id;
  insert into public.price_alert_preferences (user_id, area, threshold_pence, token)
    values (p_user_id, p_area, p_threshold_pence, p_token)
  on conflict (user_id) do update set area = excluded.area,
    threshold_pence = excluded.threshold_pence, token = excluded.token,
    enabled_at = case when price_alert_preferences.area is distinct from excluded.area
      or price_alert_preferences.threshold_pence is distinct from excluded.threshold_pence
      then now() else price_alert_preferences.enabled_at end;
end;
$$;
revoke all on function public.price_alert_bind(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.price_alert_bind(uuid, text, integer, text) to service_role;

create function public.price_alert_claim(p_user_id uuid, p_event_id text, p_token text, p_area text, p_threshold_pence integer, p_recorded_at timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare inserted integer;
begin
  insert into public.price_alert_claims (user_id, event_id, area, alert_day)
    select p_user_id, p_event_id, p_area, (now() at time zone 'Europe/London')::date from public.price_alert_preferences
    where user_id = p_user_id and token = p_token and area = p_area and threshold_pence = p_threshold_pence
      and p_recorded_at > enabled_at and p_recorded_at <= now()
  on conflict do nothing;
  get diagnostics inserted = row_count;
  return inserted = 1;
end;
$$;
revoke all on function public.price_alert_claim(uuid, text, text, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.price_alert_claim(uuid, text, text, text, integer, timestamptz) to service_role;

create function public.price_alert_due(p_after_user uuid, p_limit integer)
returns table (user_id uuid, area text, threshold_pence integer, token text, enabled_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.area, p.threshold_pence, p.token, p.enabled_at
  from public.price_alert_preferences p
  where (p_after_user is null or p.user_id > p_after_user)
    and not exists (select 1 from public.price_alert_claims c
      where c.user_id = p.user_id and c.area = p.area
        and c.alert_day = (now() at time zone 'Europe/London')::date)
  order by p.user_id
  limit least(greatest(coalesce(p_limit, 0), 0), 500);
$$;
revoke all on function public.price_alert_due(uuid, integer) from public, anon, authenticated;
grant execute on function public.price_alert_due(uuid, integer) to service_role;

create table public.price_alert_listing_seen (
  event_id text primary key,
  first_seen timestamptz not null default now()
);
alter table public.price_alert_listing_seen enable row level security;
revoke all on public.price_alert_listing_seen from public, anon, authenticated;
grant all on public.price_alert_listing_seen to service_role;

create function public.price_alert_observe_listings(p_ids text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(array_length(p_ids, 1), 0) > 100000 then
    raise exception 'Too many price events';
  end if;
  insert into public.price_alert_listing_seen (event_id)
  select distinct id from unnest(p_ids) as id
  where id ~ '^listed:[0-9a-f]{64}$'
  on conflict do nothing;
end;
$$;
revoke all on function public.price_alert_observe_listings(text[]) from public, anon, authenticated;
grant execute on function public.price_alert_observe_listings(text[]) to service_role;

commit;
