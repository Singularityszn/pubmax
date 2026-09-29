
create or replace function public.decide_plan_route_proposal_atomic(
  p_plan_id uuid,
  p_proposal_id uuid,
  p_token_hash text,
  p_decision text,
  p_idempotency_key text,
  p_decided_at timestamptz
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host_hash text;
  v_proposal public.plan_route_proposals%rowtype;
  v_revision integer;
  v_status text;
  v_current_unresolved jsonb;
  v_stop_count integer;
begin
  if public._social_plan_is_bound(p_plan_id) then return 'not_found'; end if;
  if p_decision not in ('accepted', 'rejected') then return 'invalid'; end if;

  select token_hash into v_host_hash
  from public.plan_crew_members
  where plan_id = p_plan_id
  order by joined_at, id
  limit 1;
  if v_host_hash is null or v_host_hash <> p_token_hash then return 'forbidden'; end if;

  select * into v_proposal
  from public.plan_route_proposals
  where id = p_proposal_id and plan_id = p_plan_id
  for update;
  if not found then return 'not_found'; end if;
  if v_proposal.status = p_decision and v_proposal.decision_idempotency_key = p_idempotency_key then return 'already_decided'; end if;
  if v_proposal.status <> 'pending' then return 'conflict'; end if;

  v_stop_count := jsonb_array_length(v_proposal.stops);
  if p_decision = 'accepted' then
    if v_stop_count not between 3 and 6 then return 'invalid'; end if;
    if (
      select count(distinct item->>'venueId') <> v_stop_count
        or count(distinct item->>'position') <> v_stop_count
        or count(*) filter (
          where nullif(btrim(item->>'venueId'), '') is null
             or nullif(btrim(item->>'venueName'), '') is null
             or not exists (
               select 1 from generate_series(0, v_stop_count - 1) position
               where position::text = item->>'position'
             )
        ) > 0
      from jsonb_array_elements(v_proposal.stops) item
    ) then return 'invalid'; end if;

    select coalesce(jsonb_agg(constraint_row.id::text), '[]'::jsonb) into v_current_unresolved
    from public.plan_constraints constraint_row
    where constraint_row.plan_id = p_plan_id
      and constraint_row.priority = 'required'
      and not (
        constraint_row.resolution_evidence->>'proposalId' = p_proposal_id::text
        and constraint_row.resolution_evidence->'routeRevision' = to_jsonb(v_proposal.expected_route_revision)
        and (
          select count(distinct source->>'venueId')
          from jsonb_array_elements(coalesce(constraint_row.resolution_evidence->'sources', '[]'::jsonb)) source
          where exists (
            select 1 from jsonb_array_elements(v_proposal.stops) stop
            where stop->>'venueId' = source->>'venueId'
          )
        ) = v_stop_count
      );
    update public.plan_route_proposals set unresolved_constraint_ids = v_current_unresolved where id = p_proposal_id;
    if jsonb_array_length(v_current_unresolved) > 0 then return 'constraints_unresolved'; end if;

    select route_revision, status into v_revision, v_status from public.plans where id = p_plan_id for update;
    if v_revision is null then return 'not_found'; end if;
    if v_status in ('completed', 'abandoned') then return 'invalid'; end if;
    if v_revision <> v_proposal.expected_route_revision then return 'conflict'; end if;

    delete from public.plan_stops where plan_id = p_plan_id;
    insert into public.plan_stops (plan_id, venue_id, venue_name, position, selected_drink_price_evidence)
    select p_plan_id, item->>'venueId', item->>'venueName', (item->>'position')::integer,
      item->'selectedDrinkPriceEvidence'
    from jsonb_array_elements(v_proposal.stops) item;
    update public.plans set route_revision = route_revision + 1 where id = p_plan_id;
  end if;

  update public.plan_route_proposals
  set status = p_decision, decision_idempotency_key = p_idempotency_key, decided_at = p_decided_at
  where id = p_proposal_id;
  return 'decided';
end;
$$;

create or replace function public.update_legacy_plan_status_context_atomic(
  p_plan_id uuid,p_token_hash text,p_status text,p_context jsonb
) returns text
language plpgsql security definer set search_path=''
as $$
declare v_plan public.plans%rowtype; v_host_token text;
begin
  select * into v_plan from public.plans where id=p_plan_id for update;
  if not found or v_plan.social_owner_account_id is not null then return 'not_found'; end if;

  select token_hash into v_host_token from public.plan_crew_members
    where plan_id=p_plan_id order by joined_at,id limit 1;
  if v_host_token is null or p_token_hash is null or v_host_token <> p_token_hash then return 'forbidden'; end if;

  if p_status is not null and (
    p_status not in ('draft','ready','active','ending','completed','abandoned')
    or not (
      p_status=v_plan.status
      or (v_plan.status='draft' and p_status in ('ready','abandoned'))
      or (v_plan.status='ready' and p_status in ('draft','active','abandoned'))
      or (v_plan.status='active' and p_status in ('ending','completed','abandoned'))
      or (v_plan.status='ending' and p_status in ('active','completed','abandoned'))
    )
  ) then return 'invalid'; end if;

  update public.plans set
    status=coalesce(p_status,status),
    night_context=coalesce(p_context,night_context)
  where id=p_plan_id;

  if p_context is not null then
    update public.plan_stops
    set selected_drink_price_evidence = null
    where plan_id = p_plan_id
      and selected_drink_price_evidence is not null
      and (
        p_context->>'zeroProof' = 'true'
        or selected_drink_price_evidence->>'category' is distinct from p_context->>'drinkCategory'
      );
  end if;
  return 'ok';
end;
$$;

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
  insert into public.plan_stops (plan_id, venue_id, venue_name, position, selected_drink_price_evidence)
  select p_plan_id, item.value->>'venueId', item.value->>'venueName', item.ordinality - 1,
    case
      when coalesce(p_context, current_plan.night_context)->>'zeroProof' = 'true'
        or item.value->'selectedDrinkPriceEvidence'->>'category'
          is distinct from coalesce(p_context, current_plan.night_context)->>'drinkCategory'
      then null
      else item.value->'selectedDrinkPriceEvidence'
    end
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

drop function public.plan_stop_evidence_for_context(jsonb,jsonb);
