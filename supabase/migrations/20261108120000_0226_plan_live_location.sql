-- 0226: Live location for one night out. Opt-in per person, latest fix only.
-- Captain applies; agents ship SQL only.
--
-- Reverse: supabase/migrations/rollback/20261108120000_0226_plan_live_location_rollback.sql
--
-- One row per sharing member per Plan: the latest fix and when it expires. No
-- history is kept. Sharing opens three hours before the start and ends at the
-- Plan's end (start + 8 hours, or an ending) or at the first 06:00 London time
-- after the window opens, whichever comes first.
--
-- Browser roles hold no table or function privileges. The API spends either a
-- Plan member capability (a classic Plan) or a verified Social account that
-- holds an active seat in the Open Crew bound to the Plan. A revoked, left or
-- removed member reads nothing and their row is deleted in the same
-- transaction that ends the seat.
begin;

create table public.plan_live_locations (
  plan_id uuid not null references public.plans(id) on delete cascade,
  member_id uuid not null references public.plan_crew_members(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m integer check (accuracy_m is null or accuracy_m between 0 and 10000),
  updated_at timestamptz not null,
  expires_at timestamptz not null,
  primary key (plan_id, member_id),
  check (expires_at > updated_at)
);
create index plan_live_locations_member_idx on public.plan_live_locations(member_id);
create index plan_live_locations_expires_idx on public.plan_live_locations(expires_at);
alter table public.plan_live_locations enable row level security;
revoke all on public.plan_live_locations from public, anon, authenticated;
grant all on public.plan_live_locations to service_role;

create table public.plan_live_location_stops (
  plan_id uuid not null references public.plans(id) on delete cascade,
  member_id uuid not null references public.plan_crew_members(id) on delete cascade,
  stopped_at timestamptz not null,
  expires_at timestamptz not null,
  primary key (plan_id, member_id)
);
create index plan_live_location_stops_member_idx on public.plan_live_location_stops(member_id);
create index plan_live_location_stops_expires_idx on public.plan_live_location_stops(expires_at);
alter table public.plan_live_location_stops enable row level security;
revoke all on public.plan_live_location_stops from public, anon, authenticated;
grant all on public.plan_live_location_stops to service_role;

-- A seat that ends, or a night that ends or moves, takes its positions with it.
create function public.forget_plan_live_locations() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_table_name = 'plans' then
    delete from public.plan_live_locations where plan_id = new.id;
    delete from public.plan_live_location_stops where plan_id = new.id;
  elsif tg_table_name = 'plan_crew_members' then
    delete from public.plan_live_locations where member_id = new.id;
  else
    delete from public.plan_live_locations where member_id = new.plan_member_id;
  end if;
  return new;
end;
$$;
revoke all on function public.forget_plan_live_locations() from public, anon, authenticated;

create trigger plan_end_forgets_live_locations after update of status, start_time on public.plans
for each row when (new.status in ('ending', 'completed', 'abandoned')
  or old.start_time is distinct from new.start_time)
execute function public.forget_plan_live_locations();
create trigger plan_seat_end_forgets_live_location after update of membership_revoked_at on public.plan_crew_members
for each row when (new.membership_revoked_at is not null)
execute function public.forget_plan_live_locations();
create trigger crew_seat_end_forgets_live_location after update of state on public.social_crew_members
for each row when (new.state <> 'active')
execute function public.forget_plan_live_locations();

-- The Plan's end (start + 8 hours) or the first 06:00 London time after the
-- window opens, whichever comes first. lib/planLiveLocation.ts mirrors it.
create function public.plan_live_location_ends_at(p_start timestamptz) returns timestamptz
language sql stable set search_path = '' as $$
  select least(
    p_start + interval '8 hours',
    (date_trunc('day', (p_start - interval '3 hours') at time zone 'Europe/London')
      + case when ((p_start - interval '3 hours') at time zone 'Europe/London')::time < time '06:00'
        then interval '6 hours' else interval '30 hours' end) at time zone 'Europe/London'
  );
$$;
revoke all on function public.plan_live_location_ends_at(timestamptz) from public, anon, authenticated;
grant execute on function public.plan_live_location_ends_at(timestamptz) to service_role;

create function public.plan_live_location(
  p_plan_id uuid,
  p_token_hash text,
  p_social_account_id uuid,
  p_operation text,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy_m integer default null,
  p_start_at timestamptz default null
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_plan public.plans%rowtype;
  v_member uuid;
  v_host uuid;
  v_now timestamptz;
  v_end timestamptz;
  v_live boolean;
  v_sharing boolean;
  v_people jsonb;
begin
  if p_operation is null or p_operation not in ('read', 'share', 'stop') then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if p_operation = 'share' and (p_latitude is null or p_longitude is null
    or p_latitude not between -90 and 90 or p_longitude not between -180 and 180
    or (p_accuracy_m is not null and p_accuracy_m not between 0 and 10000)) then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  select * into v_plan from public.plans
  where id = p_plan_id and social_owner_account_id is null for share;

  if found then
    if p_token_hash is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    select id into v_host from public.plan_crew_members
    where plan_id = p_plan_id and membership_revoked_at is null order by joined_at, id limit 1;
    select id into v_member from public.plan_crew_members
    where plan_id = p_plan_id and token_hash = p_token_hash and membership_revoked_at is null
      and (p_operation = 'stop' or can_collaborate or id = v_host)
    for no key update;
  else
    if p_social_account_id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    perform 1 from public.social_crews where plan_id = p_plan_id for share;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    select seat.id into v_member
    from public.social_crews crew
    join public.social_crew_members member on member.crew_id = crew.id
    join public.plan_crew_members seat on seat.id = member.plan_member_id
    where crew.plan_id = p_plan_id and member.social_account_id = p_social_account_id
      and member.state = 'active' and seat.membership_revoked_at is null
    for share of member for no key update of seat;
    if p_operation <> 'stop' and not exists (
      select 1 from public.social_crews crew
      join public.private_social_accounts account on account.id = p_social_account_id
        and account.ownership_state = 'active'
      join public.private_social_accounts owner_account on owner_account.id = crew.owner_account_id
        and owner_account.ownership_state = 'active'
      where crew.plan_id = p_plan_id
        and public.social_relationship_between_profiles(account.profile_id, owner_account.profile_id) is distinct from 'blocked'
    ) then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    select * into v_plan from public.plans where id = p_plan_id for share;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  end if;
  if v_member is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  v_now := clock_timestamp();
  if p_operation = 'share' and p_start_at is not null
    and (not isfinite(p_start_at) or p_start_at <= 'epoch'::timestamptz or p_start_at > v_now) then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  v_end := public.plan_live_location_ends_at(v_plan.start_time);
  v_live := v_plan.status not in ('ending', 'completed', 'abandoned')
    and v_now >= v_plan.start_time - interval '3 hours' and v_now < v_end;

  delete from public.plan_live_locations
  where plan_id = p_plan_id and (not v_live or expires_at <= v_now);
  delete from public.plan_live_location_stops
  where plan_id = p_plan_id and (not v_live or expires_at <= v_now);

  if p_operation = 'share' then
    if not v_live then return jsonb_build_object('ok', false, 'error', 'ended'); end if;
    if exists (select 1 from public.plan_live_location_stops
      where plan_id = p_plan_id and member_id = v_member
        and (p_start_at is null or p_start_at <= stopped_at)) then
      return jsonb_build_object('ok', false, 'error', 'stopped');
    end if;
    insert into public.plan_live_locations (plan_id, member_id, latitude, longitude, accuracy_m, updated_at, expires_at)
    select p_plan_id, v_member, p_latitude, p_longitude, p_accuracy_m, v_now, v_end
    where v_plan.social_owner_account_id is null
      or exists (
        select 1 from public.private_social_accounts account
        join public.private_social_accounts owner_account on owner_account.id = v_plan.social_owner_account_id
          and owner_account.ownership_state = 'active'
        where account.id = p_social_account_id and account.ownership_state = 'active'
          and public.social_relationship_between_profiles(account.profile_id, owner_account.profile_id)
            in ('self', 'mutual', 'not_mutual'))
    on conflict (plan_id, member_id) do update set
      latitude = excluded.latitude, longitude = excluded.longitude, accuracy_m = excluded.accuracy_m,
      updated_at = excluded.updated_at, expires_at = excluded.expires_at;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    if p_start_at is not null then
      delete from public.plan_live_location_stops where plan_id = p_plan_id and member_id = v_member;
    end if;
  elsif p_operation = 'stop' then
    if v_live then
      insert into public.plan_live_location_stops (plan_id, member_id, stopped_at, expires_at)
      values (p_plan_id, v_member, v_now, v_end)
      on conflict (plan_id, member_id) do update set stopped_at = excluded.stopped_at, expires_at = excluded.expires_at;
    end if;
    delete from public.plan_live_locations where plan_id = p_plan_id and member_id = v_member;
    return jsonb_build_object('ok', true, 'view', jsonb_build_object(
      'visibility', 'member', 'live', v_live,
      'endsAt', case when v_live then v_end else null end,
      'sharing', false, 'people', '[]'::jsonb));
  end if;

  v_sharing := exists (select 1 from public.plan_live_locations where plan_id = p_plan_id and member_id = v_member);
  select coalesce(jsonb_agg(jsonb_build_object(
      'memberId', seat.id, 'name', seat.name,
      'latitude', location.latitude, 'longitude', location.longitude,
      'accuracyM', location.accuracy_m, 'updatedAt', location.updated_at
    ) order by seat.joined_at, seat.id), '[]'::jsonb)
  into v_people
  from public.plan_live_locations location
  join public.plan_crew_members seat on seat.id = location.member_id
    and seat.plan_id = p_plan_id and seat.membership_revoked_at is null
  where location.plan_id = p_plan_id and location.member_id <> v_member
    and (case when v_plan.social_owner_account_id is null
      then seat.can_collaborate or seat.id = v_host
      else exists (
        select 1 from public.social_crews crew
        join public.social_crew_members member on member.crew_id = crew.id
        join public.private_social_accounts account on account.id = member.social_account_id
        join public.private_social_accounts owner_account on owner_account.id = crew.owner_account_id
          and owner_account.ownership_state = 'active'
        where crew.plan_id = p_plan_id and member.plan_member_id = seat.id
          and member.state = 'active' and account.ownership_state = 'active'
          and public.social_relationship_between_profiles(account.profile_id, owner_account.profile_id) is distinct from 'blocked')
      end)
  having v_plan.social_owner_account_id is null
    or exists (
      select 1 from public.private_social_accounts account
      join public.private_social_accounts owner_account on owner_account.id = v_plan.social_owner_account_id
        and owner_account.ownership_state = 'active'
      where account.id = p_social_account_id and account.ownership_state = 'active'
        and public.social_relationship_between_profiles(account.profile_id, owner_account.profile_id)
          in ('self', 'mutual', 'not_mutual'));
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  return jsonb_build_object('ok', true, 'view', jsonb_build_object(
    'visibility', 'member', 'live', v_live,
    'endsAt', case when v_live then v_end else null end,
    'sharing', v_sharing, 'people', case when v_live then v_people else '[]'::jsonb end));
end;
$$;
revoke all on function public.plan_live_location(uuid,text,uuid,text,double precision,double precision,integer,timestamptz) from public, anon, authenticated;
grant execute on function public.plan_live_location(uuid,text,uuid,text,double precision,double precision,integer,timestamptz) to service_role;

commit;

-- The 06:00 deadline holds even when nobody reads after it. A cluster without
-- pg_cron gets a NOTICE and no job; the function above still withholds and
-- deletes expired rows on the next call for that Plan.
do $migration$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available on this cluster; expired plan_live_locations clear on the next read';
    return;
  end if;
  if current_setting('cron.database_name', true) is null then
    raise notice 'pg_cron is not loaded at server start on this cluster; expired plan_live_locations clear on the next read';
    return;
  end if;
  execute 'create extension if not exists pg_cron with schema pg_catalog';
  perform cron.schedule(
    'pubmax-purge-plan-live-locations',
    '* * * * *',
    $job$delete from public.plan_live_locations where expires_at <= now();
      delete from public.plan_live_location_stops where expires_at <= now()$job$
  );
end
$migration$;
