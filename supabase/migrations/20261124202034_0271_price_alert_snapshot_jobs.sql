alter table public.price_alert_preferences add column activation_state text not null default 'active' check (activation_state in ('pending', 'active')),
  add column pending_snapshot text;
alter table public.price_alert_listing_seen add column last_snapshot text;

create or replace function public.price_alert_bind(p_user_id uuid, p_area text, p_threshold_pence integer, p_token text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_token, 0));
  delete from public.price_alert_preferences where token = p_token and user_id <> p_user_id;
  insert into public.price_alert_preferences (user_id, area, threshold_pence, token, activation_state)
    values (p_user_id, p_area, p_threshold_pence, p_token, 'pending')
  on conflict (user_id) do update set area = excluded.area, threshold_pence = excluded.threshold_pence,
    token = excluded.token,
    activation_state = case when price_alert_preferences.area is distinct from excluded.area then 'pending' else price_alert_preferences.activation_state end,
    pending_snapshot = case when price_alert_preferences.area is distinct from excluded.area then null else price_alert_preferences.pending_snapshot end,
    enabled_at = case when price_alert_preferences.area is distinct from excluded.area then now() else price_alert_preferences.enabled_at end;
end $$;

create function public.bind_price_alert_snapshot(p_user_id uuid, p_area text, p_threshold_pence integer, p_token text, p_snapshot text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_snapshot is null or p_snapshot = '' then raise exception 'snapshot required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_token, 0));
  delete from public.price_alert_preferences where token = p_token and user_id <> p_user_id;
  insert into public.price_alert_preferences (user_id, area, threshold_pence, token, activation_state, pending_snapshot)
    values (p_user_id, p_area, p_threshold_pence, p_token, 'pending', p_snapshot)
  on conflict (user_id) do update set area = excluded.area, threshold_pence = excluded.threshold_pence, token = excluded.token,
    activation_state = case when price_alert_preferences.area is distinct from excluded.area then 'pending' else price_alert_preferences.activation_state end,
    pending_snapshot = case when price_alert_preferences.area is distinct from excluded.area then excluded.pending_snapshot else price_alert_preferences.pending_snapshot end,
    enabled_at = case when price_alert_preferences.area is distinct from excluded.area then now() else price_alert_preferences.enabled_at end;
end $$;

create function public.price_alert_activate_pending(p_version text, p_lease uuid, p_limit integer)
returns integer language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  perform 1 from public.price_alert_snapshot_jobs where version = p_version and lease = p_lease and lease_until > now() and phase in ('dispatch', 'complete');
  if not found then raise exception 'snapshot not ready'; end if;
  with next as (select user_id from public.price_alert_preferences where activation_state = 'pending' and (pending_snapshot is null or pending_snapshot <= p_version) order by user_id limit least(greatest(p_limit, 0), 100) for update skip locked)
  update public.price_alert_preferences p set activation_state = 'active', pending_snapshot = null, enabled_at = now()
  from next where p.user_id = next.user_id and p.activation_state = 'pending';
  get diagnostics changed = row_count;
  return changed;
end $$;

create table public.price_alert_snapshot_jobs (
  version text primary key,
  phase text not null default 'indexing' check (phase in ('indexing', 'dispatch', 'complete')),
  observation_offset integer not null default 0 check (observation_offset >= 0),
  event_offset integer not null default 0 check (event_offset >= 0),
  recipient_cursor uuid,
  lease uuid,
  lease_until timestamptz
);
alter table public.price_alert_snapshot_jobs enable row level security;
revoke all on public.price_alert_snapshot_jobs from public, anon, authenticated;
grant select, insert, update on public.price_alert_snapshot_jobs to service_role;

create function public.claim_price_alert_snapshot(p_version text, p_lease uuid)
returns table (phase text, observation_offset integer, event_offset integer, recipient_cursor uuid)
language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('price-alert-snapshot', 0));
  if exists (select 1 from public.price_alert_snapshot_jobs where lease is not null and lease_until > now()) then return; end if;
  insert into public.price_alert_snapshot_jobs (version, lease, lease_until) values (p_version, p_lease, now() + interval '35 seconds')
  on conflict (version) do update set lease = excluded.lease, lease_until = excluded.lease_until;
  return query select s.phase, s.observation_offset, s.event_offset, s.recipient_cursor from public.price_alert_snapshot_jobs s where s.version = p_version and s.lease = p_lease;
end $$;

create function public.observe_price_alert_snapshot(p_version text, p_lease uuid, p_offset integer, p_ids text[], p_last boolean)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  if coalesce(array_length(p_ids, 1), 0) > 500 then raise exception 'batch too large'; end if;
  perform 1 from public.price_alert_snapshot_jobs where version = p_version and lease = p_lease and lease_until > now() and phase = 'indexing' and observation_offset = p_offset for update;
  if not found then return false; end if;
  perform public.price_alert_observe_listings(p_ids);
  update public.price_alert_listing_seen set last_snapshot = p_version
    where event_id = any(p_ids) and (last_snapshot is null or last_snapshot < p_version);
  update public.price_alert_snapshot_jobs set observation_offset = p_offset + coalesce(array_length(p_ids,1),0), phase = case when p_last then 'dispatch' else 'indexing' end where version = p_version and lease = p_lease;
  get diagnostics changed = row_count;
  return changed = 1;
end $$;

create function public.advance_price_alert_snapshot(p_version text, p_lease uuid, p_event_offset integer, p_recipient_cursor uuid, p_complete boolean, p_release boolean)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  update public.price_alert_snapshot_jobs set event_offset = p_event_offset, recipient_cursor = p_recipient_cursor,
    phase = case when p_complete then 'complete' else phase end,
    lease = case when p_release then null else lease end, lease_until = case when p_release then null else lease_until end
  where version = p_version and lease = p_lease and lease_until > now();
  get diagnostics changed = row_count;
  return changed = 1;
end $$;

revoke all on function public.price_alert_activate_pending(text,uuid,integer) from public, anon, authenticated;
revoke all on function public.bind_price_alert_snapshot(uuid,text,integer,text,text) from public, anon, authenticated;
revoke all on function public.claim_price_alert_snapshot(text,uuid) from public, anon, authenticated;
revoke all on function public.observe_price_alert_snapshot(text,uuid,integer,text[],boolean) from public, anon, authenticated;
revoke all on function public.advance_price_alert_snapshot(text,uuid,integer,uuid,boolean,boolean) from public, anon, authenticated;
grant execute on function public.price_alert_activate_pending(text,uuid,integer) to service_role;
grant execute on function public.bind_price_alert_snapshot(uuid,text,integer,text,text) to service_role;
grant execute on function public.claim_price_alert_snapshot(text,uuid) to service_role;
grant execute on function public.observe_price_alert_snapshot(text,uuid,integer,text[],boolean) to service_role;
grant execute on function public.advance_price_alert_snapshot(text,uuid,integer,uuid,boolean,boolean) to service_role;

create or replace function public.price_alert_claim_delivery(p_user_id uuid, p_event_id text, p_token text, p_area text, p_threshold_pence integer, p_recorded_at timestamptz, p_attempt uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare inserted integer; current_day date := (now() at time zone 'Europe/London')::date;
begin
  insert into public.price_alert_claims (user_id, event_id, area, alert_day, delivery_state, delivery_attempt)
    select p_user_id, p_event_id, p_area, current_day, 'sending', p_attempt from public.price_alert_preferences
    where user_id = p_user_id and token = p_token and area = p_area and threshold_pence = p_threshold_pence
      and activation_state = 'active' and p_recorded_at > enabled_at and p_recorded_at <= now()
  on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted = 1 then return true; end if;
  begin
    update public.price_alert_claims c set delivery_state = 'sending', delivery_attempt = p_attempt, alert_day = current_day, updated_at = now()
    where c.user_id = p_user_id and c.event_id = p_event_id and c.area = p_area and c.delivery_state = 'retryable'
      and exists (select 1 from public.price_alert_preferences p where p.user_id = p_user_id and p.token = p_token and p.area = p_area and p.threshold_pence = p_threshold_pence and p.activation_state = 'active' and p_recorded_at > p.enabled_at and p_recorded_at <= now());
  exception when unique_violation then return false;
  end;
  get diagnostics inserted = row_count;
  return inserted = 1;
end $$;

create or replace function public.price_alert_claim(p_user_id uuid, p_event_id text, p_token text, p_area text, p_threshold_pence integer, p_recorded_at timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare inserted integer;
begin
  insert into public.price_alert_claims (user_id, event_id, area, alert_day)
    select p_user_id, p_event_id, p_area, (now() at time zone 'Europe/London')::date from public.price_alert_preferences
    where user_id = p_user_id and token = p_token and area = p_area and threshold_pence = p_threshold_pence
      and activation_state = 'active' and p_recorded_at > enabled_at and p_recorded_at <= now()
  on conflict do nothing;
  get diagnostics inserted = row_count;
  return inserted = 1;
end;
$$;

create or replace function public.price_alert_due(p_after_user uuid, p_limit integer)
returns table (user_id uuid, area text, threshold_pence integer, token text, enabled_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.area, p.threshold_pence, p.token, p.enabled_at
  from public.price_alert_preferences p
  where p.activation_state = 'active' and (p_after_user is null or p.user_id > p_after_user)
    and (exists (select 1 from public.price_alert_claims c where c.user_id = p.user_id and c.area = p.area and c.delivery_state = 'retryable')
      or not exists (select 1 from public.price_alert_claims c where c.user_id = p.user_id and c.area = p.area and c.alert_day = (now() at time zone 'Europe/London')::date))
  order by p.user_id limit least(greatest(coalesce(p_limit, 0), 0), 500);
$$;
