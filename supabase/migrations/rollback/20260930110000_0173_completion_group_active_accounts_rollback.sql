-- Cost: restores the 0169 capture rule, so a later completion may include a
-- suspended Social member whose Crew seat remains active.
create or replace function pubmax_private.snapshot_plan_completion_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into pubmax_private.plan_completion_group_snapshots
    (completion_id, plan_id, completed_at, account_keys)
  select new.id, new.plan_id, new.completed_at,
    coalesce(array_agg(distinct identity.account_key order by identity.account_key)
      filter (where identity.account_key is not null), '{}'::text[])
  from public.plan_crew_members member
  left join public.private_social_accounts linked
    on linked.supabase_user_id = member.user_id
  cross join lateral (select case
    when member.social_account_id is not null
      then 'social:' || member.social_account_id::text
    when linked.id is not null then 'social:' || linked.id::text
    when member.user_id is not null then 'auth:' || member.user_id::text
  end as account_key) identity
  where member.plan_id = new.plan_id
    and member.membership_revoked_at is null
    and member.joined_at <= new.completed_at
    and (member.social_account_id is null or exists (
      select 1 from public.social_crew_members social_member
      join public.social_crews crew on crew.id = social_member.crew_id
      where crew.plan_id = new.plan_id
        and social_member.plan_member_id = member.id
        and social_member.social_account_id = member.social_account_id
        and social_member.state = 'active'
    ));
  return new;
end;
$$;

-- Cost: restore the prior completion lock order and its deletion race.
create or replace function public.complete_social_crew_plan_atomic(
  p_actor_account_id uuid,
  p_crew_id uuid,
  p_expected_route_revision integer,
  p_completion_id uuid,
  p_action_id uuid,
  p_arrival_action_id uuid,
  p_arrived_stop_position integer,
  p_ending text,
  p_terminal_venue_id text,
  p_ending_selection jsonb,
  p_completed_at timestamptz
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_plan public.plans%rowtype;
  v_actor_member_id uuid;
  v_snapshot jsonb;
  v_arrival public.plan_actions%rowtype;
begin
  -- One Plan lock serializes retries and membership changes with Crew writes.
  select plan.* into v_plan
  from public.plans plan
  join public.social_crews crew on crew.plan_id = plan.id
  where crew.id = p_crew_id and plan.social_owner_account_id = crew.owner_account_id
  for update of plan;
  if not found then return 'not_found'; end if;

  select plan_member.id into v_actor_member_id
  from public.social_crews crew
  join public.social_crew_members member
    on member.crew_id = crew.id and member.social_account_id = p_actor_account_id
    and member.role = 'owner' and member.state = 'active'
  join public.plan_crew_members plan_member
    on plan_member.id = member.plan_member_id and plan_member.plan_id = v_plan.id
    and plan_member.social_account_id = p_actor_account_id
    and plan_member.membership_revoked_at is null
  join public.private_social_accounts account
    on account.id = p_actor_account_id and account.ownership_state = 'active'
  where crew.id = p_crew_id and crew.owner_account_id = p_actor_account_id;
  if v_actor_member_id is null then return 'not_found'; end if;
  if v_plan.route_revision <> p_expected_route_revision then return 'conflict'; end if;
  if exists (select 1 from public.plan_completions where plan_id = v_plan.id) then
    return 'already_completed';
  end if;
  if v_plan.status in ('completed', 'abandoned') then return 'invalid'; end if;
  if p_arrived_stop_position is null or not exists (
    select 1 from public.plan_stops
    where plan_id = v_plan.id and position = p_arrived_stop_position
  ) then return 'invalid'; end if;
  if p_ending is null or p_ending not in ('food', 'get_home', 'keep_going') then return 'invalid'; end if;
  if p_ending = 'food' and p_terminal_venue_id is null then return 'invalid'; end if;
  if p_terminal_venue_id is not null and not exists (
    select 1 from public.plan_stops
    where plan_id = v_plan.id and venue_id = p_terminal_venue_id
  ) then return 'invalid'; end if;
  if p_ending_selection is null or (
    jsonb_typeof(p_ending_selection) <> 'object'
    or p_ending_selection->>'kind' <> p_ending
    or coalesce(p_ending_selection->>'optionId', '') = ''
    or jsonb_typeof(p_ending_selection->'evidenceSnapshot') <> 'object'
    or (p_ending = 'food' and coalesce(p_ending_selection->>'externalPlaceId', '') = '')
    or (p_ending = 'keep_going' and coalesce(p_ending_selection->>'venueId', '') = '')
  ) then return 'invalid'; end if;

  select jsonb_agg(jsonb_build_object(
    'venueId', stop.venue_id, 'venueName', stop.venue_name, 'position', stop.position
  ) order by stop.position) into v_snapshot
  from public.plan_stops stop where stop.plan_id = v_plan.id;

  insert into public.plan_actions(id, plan_id, actor_member_id, type, stop_position, created_at)
  values(p_arrival_action_id, v_plan.id, v_actor_member_id, 'arrived', p_arrived_stop_position, p_completed_at);
  select * into v_arrival from public.plan_actions action
  where action.plan_id = v_plan.id and action.type = 'arrived'
    and action.created_at <= p_completed_at
    and exists (select 1 from public.plan_stops stop
      where stop.plan_id = v_plan.id and stop.position = action.stop_position)
  order by action.created_at, action.id limit 1;
  insert into public.plan_actions(id, plan_id, actor_member_id, type, ending, created_at)
  values(p_action_id, v_plan.id, v_actor_member_id, 'ending', p_ending, p_completed_at);
  update public.plans set status = 'completed', ending = p_ending where id = v_plan.id;
  insert into public.plan_completions(
    id, plan_id, ending, terminal_venue_id, ending_selection, final_pint_drop_id,
    actor_member_id, route_revision, route_snapshot,
    qualifying_arrival_action_id, qualifying_arrival_stop_position,
    qualifying_arrival_at, completed_at
  ) values(
    p_completion_id, v_plan.id, p_ending, p_terminal_venue_id, p_ending_selection, null,
    v_actor_member_id::text, v_plan.route_revision, v_snapshot,
    v_arrival.id, v_arrival.stop_position, v_arrival.created_at, p_completed_at
  );
  return 'completed';
end;
$$;

create or replace function public.complete_plan_atomic(
  p_plan_id uuid, p_token_hash text, p_expected_route_revision integer,
  p_completion_id uuid, p_action_id uuid, p_ending text,
  p_terminal_venue_id text, p_completed_at timestamptz
) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if public._social_plan_is_bound(p_plan_id) then return 'not_found'; end if;
  return public._0075_complete_plan_atomic_8(
    p_plan_id,p_token_hash,p_expected_route_revision,p_completion_id,p_action_id,
    p_ending,p_terminal_venue_id,p_completed_at);
end;
$$;

create or replace function public.complete_plan_atomic(
  p_plan_id uuid, p_token_hash text, p_expected_route_revision integer,
  p_completion_id uuid, p_action_id uuid, p_ending text,
  p_terminal_venue_id text, p_ending_selection jsonb, p_completed_at timestamptz
) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if public._social_plan_is_bound(p_plan_id) then return 'not_found'; end if;
  return public._0075_complete_plan_atomic_9(
    p_plan_id,p_token_hash,p_expected_route_revision,p_completion_id,p_action_id,
    p_ending,p_terminal_venue_id,p_ending_selection,p_completed_at);
end;
$$;

drop function pubmax_private.lock_plan_completion_identities(uuid);
