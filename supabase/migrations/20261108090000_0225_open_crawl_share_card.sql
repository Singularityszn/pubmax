-- Open crawl share card: the facts a link preview prints (0225).
-- Captain applies; agents ship SQL only.
-- Apply only after the captain says "apply 0225".
--
-- Reverse: supabase/migrations/rollback/20261108090000_0225_open_crawl_share_card_rollback.sql
--
-- WHAT IT IS. Launch plan P0 item 4: hosts post an open crawl's link on Luma
-- and X, and today that link unfurls as a bare "Crew". The card needs the
-- host's handle, the day and time, the area, the meeting pub, the places left
-- and the pint price band. 0115 (`read_social_crew_public_preview`) already
-- answers the first two and Stop 1; it does not answer the capacity, the seat
-- count, the host's chosen meeting pub (0208) or the stops a price band is
-- read from.
--
-- ONE SERVICE-ONLY FUNCTION, NO TABLE CHANGE. `read_social_crew_share_card`
-- holds every visibility and lifecycle rule 0115 holds, word for word: an
-- open crew, an active owner account with its active owner seat, a plan that
-- is not over, and a non-empty Stop 1. It adds:
--   capacity          the open crawl's own cap (0208), null on an open crew
--                     that carries no open crawl facts
--   memberCount       the active seats, counted as `_activate_social_crew_member`
--                     counts them, so "places left" never promises a seat the
--                     join then refuses (same rule as list_open_plan_crawls)
--   meetingVenueId    the host's meeting pub when 0208 set one, else Stop 1
--   meetingVenueName
--   stopVenueIds      the plan's venue ids in stop order
--
-- THE STOP LIST NEVER LEAVES THE SERVER. Client roles hold no grant. The app
-- reads `stopVenueIds` only to compute a min-max pint price band, and the
-- card prints that band and nothing else about the stops. Exact stops stay
-- for members, behind the verified Social read.

begin;

create or replace function public.read_social_crew_share_card(
  p_crew_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'crewId', listed.crew_id,
    'title', listed.title,
    'hostHandle', listed.host_handle,
    'startsAt', to_char(listed.start_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'capacity', listed.capacity,
    'memberCount', listed.member_count,
    'meetingVenueId', listed.meeting_venue_id,
    'meetingVenueName', listed.meeting_venue_name,
    'stopVenueIds', listed.stop_venue_ids
  )
  from (
    select
      crew.id as crew_id,
      plan.title,
      profile.handle as host_handle,
      plan.start_time,
      crew.capacity,
      (
        select count(*)::integer
        from public.social_crew_members seat
        where seat.crew_id = crew.id and seat.state = 'active'
      ) as member_count,
      coalesce(meeting.venue_id, stop.venue_id) as meeting_venue_id,
      coalesce(meeting.venue_name, stop.venue_name) as meeting_venue_name,
      (
        select coalesce(jsonb_agg(plan_stop.venue_id order by plan_stop.position, plan_stop.venue_id), '[]'::jsonb)
        from public.plan_stops plan_stop
        where plan_stop.plan_id = plan.id
          and plan_stop.venue_id is not null
          and btrim(plan_stop.venue_id) <> ''
      ) as stop_venue_ids
    from public.social_crews crew
    join public.plans plan
      on plan.id = crew.plan_id
      and plan.social_owner_account_id = crew.owner_account_id
    join public.private_social_accounts account
      on account.id = crew.owner_account_id
      and account.ownership_state = 'active'
    join public.profiles profile on profile.id = account.profile_id
    join public.social_crew_members owner_member
      on owner_member.crew_id = crew.id
      and owner_member.social_account_id = crew.owner_account_id
      and owner_member.role = 'owner'
      and owner_member.state = 'active'
    join public.plan_crew_members owner_plan_member
      on owner_plan_member.id = owner_member.plan_member_id
      and owner_plan_member.plan_id = plan.id
      and owner_plan_member.social_account_id = crew.owner_account_id
    -- Pick physical Stop 1 first, exactly as 0115 does, so a crew this card
    -- describes is a crew the public preview also describes.
    join lateral (
      select plan_stop.venue_id, plan_stop.venue_name
      from public.plan_stops plan_stop
      where plan_stop.plan_id = plan.id
      order by plan_stop.position, plan_stop.venue_id
      limit 1
    ) stop on stop.venue_id is not null and btrim(stop.venue_id) <> ''
    -- The host's meeting pub (0208) is one of the plan's own stops.
    left join lateral (
      select plan_stop.venue_id, plan_stop.venue_name
      from public.plan_stops plan_stop
      where plan_stop.plan_id = plan.id
        and crew.meeting_venue_id is not null
        and plan_stop.venue_id = crew.meeting_venue_id
        and btrim(coalesce(plan_stop.venue_name,'')) <> ''
      order by plan_stop.position
      limit 1
    ) meeting on true
    where crew.id = p_crew_id
      and crew.visibility = 'open'
      and plan.status in ('draft','ready','active','ending')
      and plan.start_time + interval '8 hours' > statement_timestamp()
      and btrim(coalesce(stop.venue_name,'')) <> ''
  ) listed;
$$;

revoke all on function public.read_social_crew_share_card(uuid)
  from public, anon, authenticated;
grant execute on function public.read_social_crew_share_card(uuid)
  to service_role;

commit;
