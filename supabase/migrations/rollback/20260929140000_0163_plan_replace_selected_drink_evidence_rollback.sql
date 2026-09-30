-- 0163 rollback: Future route replacements omit evidence; existing saved rows remain.

create or replace function public.replace_plan_route_atomic(
  p_plan_id uuid,
  p_token_hash text,
  p_expected_route_revision integer,
  p_stops jsonb,
  p_context jsonb,
  p_grounded_upgrade boolean default false
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_plan public.plans%rowtype;
  creator_id uuid;
  first_stop text;
begin
  if public._social_plan_is_bound(p_plan_id) then return 'not_found'; end if;
  select * into current_plan from public.plans where id = p_plan_id for update;
  if not found then return 'not_found'; end if;

  select member.id into creator_id
  from public.plan_crew_members member
  where member.plan_id = p_plan_id
  order by member.joined_at, member.id
  limit 1;
  if creator_id is null or not exists (
    select 1 from public.plan_crew_members
    where id = creator_id and token_hash = p_token_hash
  ) then return 'forbidden'; end if;

  if current_plan.status in ('completed', 'abandoned') then return 'invalid'; end if;
  if current_plan.route_revision <> p_expected_route_revision then return 'conflict'; end if;
  if jsonb_typeof(p_stops) <> 'array' or jsonb_array_length(p_stops) not between 3 and 6 then return 'invalid'; end if;
  if exists (
    select 1
    from jsonb_array_elements(p_stops) item
    where coalesce(item->>'venueId', '') = '' or coalesce(item->>'venueName', '') = ''
  ) or (select count(distinct item->>'venueId') from jsonb_array_elements(p_stops) item) <> jsonb_array_length(p_stops) then
    return 'invalid';
  end if;

  first_stop := p_stops->0->>'venueId';
  if current_plan.anchor_venue_id is not null
     and (not p_grounded_upgrade or first_stop <> current_plan.anchor_venue_id) then
    return 'forbidden';
  end if;

  delete from public.plan_stops where plan_id = p_plan_id;
  insert into public.plan_stops (plan_id, venue_id, venue_name, position)
  select p_plan_id, item.value->>'venueId', item.value->>'venueName', item.ordinality - 1
  from jsonb_array_elements(p_stops) with ordinality as item(value, ordinality);
  update public.plans
  set route_revision = route_revision + 1,
      night_context = coalesce(p_context, night_context),
      plan_outcome = case when anchor_venue_id is not null then 'route' else plan_outcome end,
      route_ready_at = case when anchor_venue_id is not null then coalesce(route_ready_at, now()) else route_ready_at end
  where id = p_plan_id;
  return 'ok';
end;
$$;
