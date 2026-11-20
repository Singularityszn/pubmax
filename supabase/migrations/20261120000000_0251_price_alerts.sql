begin;

create table public.price_alert_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  area text not null check (length(area) between 1 and 80),
  threshold_pence integer not null check (threshold_pence between 1 and 100000),
  token text not null unique check (length(token) between 1 and 2048)
);
create index price_alert_preferences_area_price_idx on public.price_alert_preferences (area, threshold_pence);

create table public.price_alert_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.pint_drops(id) on delete cascade,
  primary key (user_id, event_id)
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
    threshold_pence = excluded.threshold_pence, token = excluded.token;
end;
$$;
revoke all on function public.price_alert_bind(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.price_alert_bind(uuid, text, integer, text) to service_role;

create function public.price_alert_claim(p_user_id uuid, p_event_id uuid, p_token text, p_area text, p_threshold_pence integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare inserted integer;
begin
  insert into public.price_alert_claims (user_id, event_id)
    select p_user_id, p_event_id from public.price_alert_preferences
    where user_id = p_user_id and token = p_token and area = p_area and threshold_pence = p_threshold_pence
  on conflict do nothing;
  get diagnostics inserted = row_count;
  return inserted = 1;
end;
$$;
revoke all on function public.price_alert_claim(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.price_alert_claim(uuid, uuid, text, text, integer) to service_role;

commit;
