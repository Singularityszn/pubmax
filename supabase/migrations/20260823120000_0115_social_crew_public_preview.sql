-- Public Open Crew preview (0115). Captain / firstmate applies.
--
-- This read is deliberately separate from read_social_crew_snapshot. It has no
-- actor input and returns only the fields needed to view one current Open Crew
-- before sign-in. Stop 1 is resolved against the current venue/POI index by the
-- server route before the row reaches a browser.

begin;

create or replace function public.read_social_crew_public_preview(
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
    'stopVenueId', listed.stop_venue_id,
    'stopVenueName', listed.stop_venue_name
  )
  from (
    select
      crew.id as crew_id,
      plan.title,
      profile.handle as host_handle,
      plan.start_time,
      stop.venue_id as stop_venue_id,
      stop.venue_name as stop_venue_name
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
    join lateral (
      select plan_stop.venue_id, plan_stop.venue_name
      from public.plan_stops plan_stop
      where plan_stop.plan_id = plan.id
        and plan_stop.venue_id is not null
        and btrim(plan_stop.venue_id) <> ''
      order by plan_stop.position, plan_stop.venue_id
      limit 1
    ) stop on true
    where crew.id = p_crew_id
      and crew.visibility = 'open'
      and plan.status in ('draft','ready','active','ending')
      and plan.start_time + interval '8 hours' > statement_timestamp()
  ) listed;
$$;

revoke all on function public.read_social_crew_public_preview(uuid)
  from public, anon, authenticated;
grant execute on function public.read_social_crew_public_preview(uuid)
  to service_role;

commit;
