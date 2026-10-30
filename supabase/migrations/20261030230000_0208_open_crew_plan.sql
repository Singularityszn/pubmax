-- Open crawls: an Open Crew that carries its plan to strangers (0208).
-- Captain applies; agents ship SQL only.
--
-- Reverse: supabase/migrations/rollback/20261030230000_0208_open_crew_plan_rollback.sql
--
-- WHAT IT IS. Launch review 4.5, E1 "Open it up". A crew is already bound one
-- to one to a plan (0075: `plan_id uuid not null unique`), so it already
-- carries the plan id, the ordered stops and the start time. What a stranger
-- needs to decide is three more facts, and they are three NULLABLE columns on
-- the crew row, never a second crew table:
--
--   capacity          4 to 20, the existing crew cap (lib/crew.ts CREW_MAX_MEMBERS)
--   meeting_venue_id  one of the plan's own stops, checked at the write
--   description       the host's one line, 140 characters at most
--
-- The three are set together or not at all. A crew without them is every crew
-- that exists today, and nothing reads it differently.
--
-- THE CAPACITY IS REAL. `_activate_social_crew_member` is restated from 0131
-- with ONE change: both 20-member checks read the crew's own capacity, falling
-- back to 20. An accept past the capacity answers `full`, as an accept past 20
-- always has. Nothing else in the body moves.
--
-- THREE SERVICE-ONLY FUNCTIONS. RLS and grants on `social_crews` are unchanged:
-- client roles hold nothing (0075), and the service role writes through RPCs.
--   open_social_crew_with_plan_atomic  checks the three facts, then calls
--     create_social_crew_atomic with visibility 'open' under the same receipt,
--     then stamps the facts, all in one transaction. The host check is
--     create_social_crew_atomic's own: the host seat token and the first seat.
--   read_social_crew_open_crawl  the three facts plus the meeting pub's name,
--     read by the app only after the member snapshot has admitted the reader.
--   list_open_plan_crawls  upcoming open crews that carry the facts, for the
--     "Crawls you can join this week" section. It lists what the open lane
--     (0110, list_open_social_crews) already lists to anybody, plus the
--     capacity, the meeting pub and the host's line. No stop list, no member.

begin;

alter table public.social_crews
  add column if not exists capacity smallint,
  add column if not exists meeting_venue_id text,
  add column if not exists description text;

alter table public.social_crews
  drop constraint if exists social_crews_open_crawl_capacity_check;
alter table public.social_crews
  add constraint social_crews_open_crawl_capacity_check
  check (capacity is null or capacity between 4 and 20);

alter table public.social_crews
  drop constraint if exists social_crews_open_crawl_meeting_check;
alter table public.social_crews
  add constraint social_crews_open_crawl_meeting_check
  check (meeting_venue_id is null or char_length(meeting_venue_id) between 1 and 120);

alter table public.social_crews
  drop constraint if exists social_crews_open_crawl_description_check;
alter table public.social_crews
  add constraint social_crews_open_crawl_description_check
  check (description is null or char_length(description) between 1 and 140);

alter table public.social_crews
  drop constraint if exists social_crews_open_crawl_shape_check;
alter table public.social_crews
  add constraint social_crews_open_crawl_shape_check
  check (
    (capacity is null and meeting_venue_id is null and description is null)
    or (capacity is not null and meeting_venue_id is not null and description is not null)
  );

create or replace function public._activate_social_crew_member(p_crew uuid,p_account uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
  v_member public.social_crew_members%rowtype;
  v_plan uuid;
  v_handle text;
  v_user uuid;
  v_plan_member public.plan_crew_members%rowtype;
begin
  select crew.plan_id,profile.handle,account.supabase_user_id
    into v_plan,v_handle,v_user
  from public.social_crews crew
  join public.private_social_accounts account
    on account.id=p_account and account.ownership_state='active'
  join public.profiles profile on profile.id=account.profile_id
  where crew.id=p_crew;
  if v_plan is null then return null; end if;

  perform 1 from public.social_crews where id=p_crew for update;

  if v_user is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('plan:join-account:' || v_plan::text || ':' || v_user::text,0)
    );
  end if;

  select * into v_member
  from public.social_crew_members
  where crew_id=p_crew and social_account_id=p_account
  for update;

  if found then
    select * into v_plan_member
    from public.plan_crew_members
    where id=v_member.plan_member_id and plan_id=v_plan
    for update;
    if not found
      or (v_plan_member.social_account_id is not null and v_plan_member.social_account_id<>p_account)
      or (v_user is not null and v_plan_member.user_id is not null and v_plan_member.user_id<>v_user)
      or (v_user is not null and exists(
        select 1 from public.plan_crew_members other
        where other.plan_id=v_plan and other.user_id=v_user and other.id<>v_plan_member.id
      )) then
      return null;
    end if;
    if v_member.state<>'active'
      and (select count(*) from public.social_crew_members
        where crew_id=p_crew and state='active')>=coalesce((select crew.capacity from public.social_crews crew where crew.id=p_crew),20) then
      return null;
    end if;
    update public.plan_crew_members
    set social_account_id=p_account,
        user_id=coalesce(user_id,v_user),
        status='in',
        can_collaborate=true,
        updated_at=now()
    where id=v_plan_member.id;
    if v_member.state<>'active' then
      update public.social_crew_members
      set state='active',role='member',ended_at=null,updated_at=now()
      where id=v_member.id;
      update public.social_crews
      set authority_revision=authority_revision+1,updated_at=now()
      where id=p_crew;
    end if;
    return v_member.id;
  end if;

  if (select count(*) from public.social_crew_members
      where crew_id=p_crew and state='active')>=coalesce((select crew.capacity from public.social_crews crew where crew.id=p_crew),20) then
    return null;
  end if;

  if v_user is not null then
    select * into v_plan_member
    from public.plan_crew_members
    where plan_id=v_plan and user_id=v_user
    for update;
  end if;
  if not found then
    select * into v_plan_member
    from public.plan_crew_members
    where plan_id=v_plan and social_account_id=p_account
    for update;
  end if;

  if found then
    if (v_plan_member.social_account_id is not null and v_plan_member.social_account_id<>p_account)
      or (v_user is not null and v_plan_member.user_id is not null and v_plan_member.user_id<>v_user) then
      return null;
    end if;
    update public.plan_crew_members
    set social_account_id=p_account,
        user_id=coalesce(user_id,v_user),
        status='in',
        can_collaborate=true,
        updated_at=now()
    where id=v_plan_member.id
    returning * into v_plan_member;
  else
    v_plan_member.id:=gen_random_uuid();
    perform pg_catalog.set_config('pubmax.social_crew_write','1',true);
    insert into public.plan_crew_members(
      id,plan_id,name,token_hash,status,user_id,joined_at,updated_at,can_collaborate,social_account_id
    ) values(
      v_plan_member.id,v_plan,v_handle,
      encode(extensions.digest(gen_random_uuid()::text || clock_timestamp()::text,'sha256'),'hex'),
      'in',v_user,now(),now(),true,p_account
    );
  end if;

  insert into public.social_crew_members(crew_id,social_account_id,plan_member_id,role,state)
  values(p_crew,p_account,v_plan_member.id,'member','active')
  returning * into v_member;
  update public.social_crews
  set authority_revision=authority_revision+1,updated_at=now()
  where id=p_crew;
  return v_member.id;
end;
$$;

create or replace function public.open_social_crew_with_plan_atomic(
  p_actor_account_id uuid,p_plan_id uuid,p_host_token_hash text,
  p_capacity integer,p_meeting_venue_id text,p_description text,
  p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_response jsonb; v_crew uuid;
begin
  if p_capacity is null or p_capacity < 4 or p_capacity > 20
    or p_description is null or char_length(btrim(p_description)) not between 1 and 140
    or p_meeting_venue_id is null or char_length(p_meeting_venue_id) not between 1 and 120 then
    return jsonb_build_object('ok',false,'code','invalid');
  end if;
  if not exists(
    select 1 from public.plan_stops stop
    where stop.plan_id=p_plan_id and stop.venue_id=p_meeting_venue_id
  ) then
    return jsonb_build_object('ok',false,'code','invalid');
  end if;
  v_response:=public.create_social_crew_atomic(
    p_actor_account_id,p_plan_id,p_host_token_hash,'open',p_idempotency_key,p_payload_digest
  );
  if coalesce((v_response->>'ok')::boolean,false) is not true then
    return v_response;
  end if;
  v_crew:=(v_response->>'crew_id')::uuid;
  update public.social_crews
  set capacity=p_capacity,
      meeting_venue_id=p_meeting_venue_id,
      description=btrim(p_description),
      updated_at=now()
  where id=v_crew and owner_account_id=p_actor_account_id and plan_id=p_plan_id;
  if not found then
    raise exception 'open crawl % did not land on its own crew', v_crew;
  end if;
  return v_response;
end;
$$;

create or replace function public.read_social_crew_open_crawl(p_crew_id uuid)
returns jsonb language sql stable security definer set search_path=''
as $$
  select jsonb_build_object(
    'capacity', crew.capacity,
    'meetingVenueId', crew.meeting_venue_id,
    'meetingVenueName', meeting.venue_name,
    'description', crew.description
  )
  from public.social_crews crew
  join lateral (
    select stop.venue_name
    from public.plan_stops stop
    where stop.plan_id=crew.plan_id and stop.venue_id=crew.meeting_venue_id
    order by stop.position
    limit 1
  ) meeting on true
  where crew.id=p_crew_id and crew.capacity is not null;
$$;

create or replace function public.list_open_plan_crawls(
  p_from timestamptz,
  p_until timestamptz,
  p_limit integer
) returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(jsonb_agg(listed.row_obj order by listed.start_time, listed.crew_id), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'crewId', crew.id,
      'title', plan.title,
      'startTime', to_char(plan.start_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'hostHandle', profile.handle,
      'capacity', crew.capacity,
      'meetingVenueId', crew.meeting_venue_id,
      'meetingVenueName', meeting.venue_name,
      'description', crew.description,
      'memberCount', (
        select count(*)::integer
        from public.social_crew_members member
        join public.private_social_accounts member_account
          on member_account.id = member.social_account_id
          and member_account.ownership_state = 'active'
        join public.plan_crew_members plan_member
          on plan_member.id = member.plan_member_id
          and plan_member.plan_id = plan.id
          and plan_member.social_account_id = member.social_account_id
        where member.crew_id = crew.id and member.state = 'active'
      )
    ) as row_obj,
    plan.start_time,
    crew.id as crew_id
    from public.social_crews crew
    join public.plans plan
      on plan.id = crew.plan_id
      and plan.social_owner_account_id = crew.owner_account_id
    join public.private_social_accounts account
      on account.id = crew.owner_account_id
      and account.ownership_state = 'active'
    join public.profiles profile on profile.id = account.profile_id
    join lateral (
      select stop.venue_name
      from public.plan_stops stop
      where stop.plan_id = plan.id and stop.venue_id = crew.meeting_venue_id
      order by stop.position
      limit 1
    ) meeting on true
    where crew.visibility = 'open'
      and crew.capacity is not null
      and plan.status not in ('completed','abandoned')
      and plan.start_time >= p_from
      and plan.start_time < p_until
    order by plan.start_time, crew.id
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) listed;
$$;

revoke all on function public.open_social_crew_with_plan_atomic(uuid,uuid,text,integer,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.open_social_crew_with_plan_atomic(uuid,uuid,text,integer,text,text,text,text)
  to service_role;
revoke all on function public.read_social_crew_open_crawl(uuid) from public, anon, authenticated;
grant execute on function public.read_social_crew_open_crawl(uuid) to service_role;
revoke all on function public.list_open_plan_crawls(timestamptz,timestamptz,integer) from public, anon, authenticated;
grant execute on function public.list_open_plan_crawls(timestamptz,timestamptz,integer) to service_role;

commit;
