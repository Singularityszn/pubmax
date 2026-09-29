-- 0172: Accept proposal evidence only when it matches the locked Plan context.

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
  v_night_context jsonb;
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

    select route_revision, status, night_context into v_revision, v_status, v_night_context
    from public.plans where id = p_plan_id for update;
    if v_revision is null then return 'not_found'; end if;
    if v_status in ('completed', 'abandoned') then return 'invalid'; end if;
    if v_revision <> v_proposal.expected_route_revision then return 'conflict'; end if;

    delete from public.plan_stops where plan_id = p_plan_id;
    insert into public.plan_stops (plan_id, venue_id, venue_name, position, selected_drink_price_evidence)
    select p_plan_id, item->>'venueId', item->>'venueName', (item->>'position')::integer,
      case
        when v_night_context->>'zeroProof' = 'true'
          or item->'selectedDrinkPriceEvidence'->>'category'
            is distinct from v_night_context->>'drinkCategory'
        then null
        else item->'selectedDrinkPriceEvidence'
      end
    from jsonb_array_elements(v_proposal.stops) item;
    update public.plans set route_revision = route_revision + 1 where id = p_plan_id;
  end if;

  update public.plan_route_proposals
  set status = p_decision, decision_idempotency_key = p_idempotency_key, decided_at = p_decided_at
  where id = p_proposal_id;
  return 'decided';
end;
$$;
