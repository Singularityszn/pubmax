-- 0213: Find our table. A private sign at the crew's latest recorded arrival.
-- Browser roles have no table or function privileges. The API spends a member capability.
begin;

-- Historical arrivals have no reliable route version. Do not backfill a claim.
alter table public.plan_actions add column route_revision integer
  check (route_revision is null or route_revision > 0);
create function public.stamp_plan_table_beacon_action() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  select route_revision into new.route_revision from public.plans where id = new.plan_id for update;
  return new;
end;
$$;
revoke all on function public.stamp_plan_table_beacon_action() from public, anon, authenticated;
create trigger plan_action_stamps_beacon_revision before insert on public.plan_actions
for each row execute function public.stamp_plan_table_beacon_action();

create table public.plan_table_beacons (
  plan_id uuid primary key references public.plans(id) on delete cascade,
  arrival_id uuid not null references public.plan_actions(id) on delete cascade,
  route_revision integer not null check (route_revision > 0),
  symbol text not null check (symbol in ('star', 'moon', 'diamond', 'circle')),
  note text not null check (char_length(note) <= 160),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '2 hours')
);
create index plan_table_beacons_arrival_idx on public.plan_table_beacons(arrival_id);
alter table public.plan_table_beacons enable row level security;
revoke all on public.plan_table_beacons from public, anon, authenticated;
grant all on public.plan_table_beacons to service_role;

-- An advance, ending, or route replacement removes the old note in the same transaction.
create function public.invalidate_plan_table_beacon() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_table_name = 'plan_actions' then
    delete from public.plan_table_beacons where plan_id = new.plan_id;
  else
    delete from public.plan_table_beacons where plan_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.invalidate_plan_table_beacon() from public, anon, authenticated;
create trigger plan_action_invalidates_table_beacon after insert on public.plan_actions
for each row execute function public.invalidate_plan_table_beacon();
create trigger plan_change_invalidates_table_beacon after update of route_revision, status, start_time on public.plans
for each row when (old.route_revision is distinct from new.route_revision
  or new.status in ('ending', 'completed', 'abandoned')
  or old.start_time is distinct from new.start_time)
execute function public.invalidate_plan_table_beacon();

create function public.plan_table_beacon(
  p_plan_id uuid,
  p_token_hash text,
  p_operation text,
  p_symbol text default null,
  p_note text default null,
  p_expected_route_revision integer default null,
  p_expected_arrival_id uuid default null
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_plan public.plans%rowtype;
  v_member public.plan_crew_members%rowtype;
  v_host uuid;
  v_action public.plan_actions%rowtype;
  v_stop public.plan_stops%rowtype;
  v_next public.plan_stops%rowtype;
  v_beacon public.plan_table_beacons%rowtype;
  v_now timestamptz := clock_timestamp();
  v_end timestamptz;
  v_current jsonb := null;
  v_next_stop jsonb := null;
  v_arrival uuid := null;
  v_sign jsonb := null;
begin
  if p_operation is null or p_operation not in ('read', 'set', 'clear') then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  select * into v_plan from public.plans
  where id = p_plan_id and social_owner_account_id is null for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  select * into v_member from public.plan_crew_members
  where plan_id = p_plan_id and token_hash = p_token_hash and membership_revoked_at is null for share;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select id into v_host from public.plan_crew_members
  where plan_id = p_plan_id and membership_revoked_at is null order by joined_at, id limit 1;
  if v_member.id <> v_host and not v_member.can_collaborate then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if p_operation <> 'read' and v_member.id <> v_host then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  v_end := v_plan.start_time + interval '8 hours';
  if v_plan.status not in ('ending', 'completed', 'abandoned') and v_now < v_end then
    select * into v_action from public.plan_actions where plan_id = p_plan_id
    order by created_at desc, id desc limit 1;
    -- Equal timestamps give no reliable action order. Keep the table sign hidden.
    if found and v_action.type = 'arrived' and v_action.route_revision = v_plan.route_revision and (
      select count(*) from public.plan_actions where plan_id = p_plan_id and created_at = v_action.created_at
    ) = 1 then
      select * into v_stop from public.plan_stops where plan_id = p_plan_id and position = v_action.stop_position;
      if found then
        v_arrival := v_action.id;
        v_current := jsonb_build_object('venueId', v_stop.venue_id, 'venueName', v_stop.venue_name, 'position', v_stop.position);
        select * into v_next from public.plan_stops where plan_id = p_plan_id and position > v_stop.position order by position limit 1;
        if found then
          v_next_stop := jsonb_build_object('venueId', v_next.venue_id, 'venueName', v_next.venue_name, 'position', v_next.position);
        end if;
      end if;
    end if;
  end if;

  delete from public.plan_table_beacons where plan_id = p_plan_id
    and (expires_at <= v_now or route_revision <> v_plan.route_revision
      or arrival_id is distinct from v_arrival);

  if p_operation <> 'read' then
    if v_arrival is null or p_expected_arrival_id is distinct from v_arrival
      or p_expected_route_revision is distinct from v_plan.route_revision then
      return jsonb_build_object('ok', false, 'error', 'conflict');
    end if;
    if p_operation = 'clear' then
      delete from public.plan_table_beacons where plan_id = p_plan_id;
    else
      if p_symbol is null or p_symbol not in ('star', 'moon', 'diamond', 'circle')
        or p_note is null or char_length(p_note) > 160 then
        return jsonb_build_object('ok', false, 'error', 'invalid');
      end if;
      insert into public.plan_table_beacons (plan_id, arrival_id, route_revision, symbol, note, created_at, expires_at)
      values (p_plan_id, v_arrival, v_plan.route_revision, p_symbol, p_note, v_now, least(v_now + interval '2 hours', v_end))
      on conflict (plan_id) do update set
        arrival_id = excluded.arrival_id, route_revision = excluded.route_revision,
        symbol = excluded.symbol, note = excluded.note,
        created_at = case when plan_table_beacons.symbol = excluded.symbol and plan_table_beacons.note = excluded.note
          then plan_table_beacons.created_at else excluded.created_at end,
        expires_at = case when plan_table_beacons.symbol = excluded.symbol and plan_table_beacons.note = excluded.note
          then plan_table_beacons.expires_at else excluded.expires_at end;
    end if;
  end if;

  select * into v_beacon from public.plan_table_beacons where plan_id = p_plan_id;
  if found then
    v_sign := jsonb_build_object('symbol', v_beacon.symbol, 'note', v_beacon.note, 'expiresAt', v_beacon.expires_at);
  end if;
  return jsonb_build_object('ok', true, 'view', jsonb_build_object(
    'visibility', 'member', 'canEdit', v_member.id = v_host,
    'routeRevision', v_plan.route_revision, 'arrivalId', v_arrival,
    'current', v_current, 'next', v_next_stop, 'beacon', v_sign));
end;
$$;
revoke all on function public.plan_table_beacon(uuid,text,text,text,text,integer,uuid) from public, anon, authenticated;
grant execute on function public.plan_table_beacon(uuid,text,text,text,text,integer,uuid) to service_role;

commit;
