-- 0215: Keep server-verified generation checks with route proposals.
-- Only the service role creates these records. TypeScript verifies each signature.
-- Acceptance rechecks expiry, the accepted pub, the completed prefix and current needs under the Plan lock.
-- No policy or browser grant changes. Apply only on the captain's instruction.

alter table public.plan_route_proposals
  add column grounding_proof text,
  add column grounding_operation_key text,
  add column grounding_expires_at timestamptz,
  add column grounding_anchor_venue_id text,
  add column grounding_anchor_source text;

drop function public.create_plan_route_proposal_atomic(uuid,uuid,uuid,integer,jsonb,text,jsonb,jsonb,text,timestamptz);
create function public.create_plan_route_proposal_atomic(
  p_plan_id uuid,
  p_proposal_id uuid,
  p_proposed_by_member_id uuid,
  p_expected_route_revision integer,
  p_stops jsonb,
  p_reason text,
  p_resolved_constraint_ids jsonb,
  p_unresolved_constraint_ids jsonb,
  p_idempotency_key text,
  p_created_at timestamptz,
  p_token_hash text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid;
  v_host uuid;
  v_member public.plan_crew_members%rowtype;
  v_proposal public.plan_route_proposals%rowtype;
begin
  select social_owner_account_id into v_owner
  from public.plans where id=p_plan_id for update;
  if not found or v_owner is not null then return jsonb_build_object('code','not_found'); end if;
  select id into v_host from public.plan_crew_members
    where plan_id=p_plan_id and membership_revoked_at is null order by joined_at,id limit 1;
  select * into v_member from public.plan_crew_members
    where id=p_proposed_by_member_id and plan_id=p_plan_id and token_hash=p_token_hash
      and membership_revoked_at is null for share;
  if not found
    or (v_member.id is distinct from v_host and not coalesce(v_member.can_collaborate,false))
    then return jsonb_build_object('code','forbidden'); end if;
  select * into v_proposal from public.plan_route_proposals
  where plan_id=p_plan_id and proposed_by_member_id=p_proposed_by_member_id
    and idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('code','replayed','row',to_jsonb(v_proposal)); end if;
  insert into public.plan_route_proposals(
    id,plan_id,proposed_by_member_id,expected_route_revision,stops,reason,
    resolved_constraint_ids,unresolved_constraint_ids,status,idempotency_key,
    decision_idempotency_key,created_at,decided_at
  ) values(
    p_proposal_id,p_plan_id,p_proposed_by_member_id,p_expected_route_revision,p_stops,p_reason,
    p_resolved_constraint_ids,p_unresolved_constraint_ids,'pending',p_idempotency_key,
    null,p_created_at,null
  ) returning * into v_proposal;
  return jsonb_build_object('code','created','row',to_jsonb(v_proposal));
end;
$$;

revoke all on function public.create_plan_route_proposal_atomic(uuid,uuid,uuid,integer,jsonb,text,jsonb,jsonb,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.create_plan_route_proposal_atomic(uuid,uuid,uuid,integer,jsonb,text,jsonb,jsonb,text,timestamptz,text) to service_role;

create function public.create_plan_grounded_proposal_atomic(
  p_plan_id uuid, p_proposal_id uuid, p_proposed_by_member_id uuid, p_token_hash text,
  p_expected_route_revision integer, p_stops jsonb, p_reason text,
  p_resolved_constraint_ids jsonb, p_unresolved_constraint_ids jsonb,
  p_idempotency_key text, p_created_at timestamptz,
  p_grounding_proof text, p_grounding_operation_key text,
  p_grounding_expires_at timestamptz, p_grounding_anchor_venue_id text,
  p_grounding_anchor_source text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_plan public.plans%rowtype;
  v_result jsonb;
  v_id uuid;
  v_member public.plan_crew_members%rowtype;
  v_host uuid;
begin
  select * into v_plan from public.plans where id=p_plan_id for update;
  if not found or v_plan.social_owner_account_id is not null then return jsonb_build_object('code','not_found'); end if;
  select id into v_host from public.plan_crew_members
    where plan_id=p_plan_id and membership_revoked_at is null order by joined_at,id limit 1;
  select * into v_member from public.plan_crew_members
    where id=p_proposed_by_member_id and plan_id=p_plan_id
      and token_hash=p_token_hash and membership_revoked_at is null for share;
  if not found or (v_member.id is distinct from v_host and not coalesce(v_member.can_collaborate,false))
    then return jsonb_build_object('code','forbidden'); end if;
  if v_plan.route_revision <> p_expected_route_revision
    or v_plan.status in ('completed','abandoned')
    or p_grounding_expires_at is null or p_grounding_expires_at <= clock_timestamp()
    or nullif(p_grounding_proof,'') is null or length(p_grounding_proof)>8000
    or nullif(p_grounding_operation_key,'') is null
    or v_plan.anchor_venue_id is distinct from p_grounding_anchor_venue_id
    or v_plan.anchor_source is distinct from p_grounding_anchor_source
    or (v_plan.anchor_venue_id is not null and p_stops->0->>'venueId' is distinct from v_plan.anchor_venue_id)
    then return jsonb_build_object('code','conflict'); end if;
  if exists (
    select 1 from public.plan_stops s where s.plan_id=p_plan_id
      and s.position <= (select max(a.stop_position) from public.plan_actions a
        where a.plan_id=p_plan_id and a.type in ('arrived','skipped'))
      and not exists (select 1 from jsonb_array_elements(p_stops) item
        where item->>'venueId'=s.venue_id and item->>'position'=s.position::text)
  ) then return jsonb_build_object('code','conflict'); end if;
  v_result := public.create_plan_route_proposal_atomic(p_plan_id,p_proposal_id,p_proposed_by_member_id,
    p_expected_route_revision,p_stops,p_reason,p_resolved_constraint_ids,p_unresolved_constraint_ids,
    p_idempotency_key,p_created_at,p_token_hash);
  if v_result->>'code' <> 'created' then return v_result; end if;
  v_id := (v_result->'row'->>'id')::uuid;
  update public.plan_route_proposals set
    grounding_proof=p_grounding_proof, grounding_operation_key=p_grounding_operation_key,
    grounding_expires_at=p_grounding_expires_at, grounding_anchor_venue_id=p_grounding_anchor_venue_id,
    grounding_anchor_source=p_grounding_anchor_source where id=v_id;
  select jsonb_build_object('code','created','row',to_jsonb(p)) into v_result
    from public.plan_route_proposals p where p.id=v_id;
  return v_result;
end;
$$;
revoke all on function public.create_plan_grounded_proposal_atomic(uuid,uuid,uuid,text,integer,jsonb,text,jsonb,jsonb,text,timestamptz,text,text,timestamptz,text,text) from public, anon, authenticated;
grant execute on function public.create_plan_grounded_proposal_atomic(uuid,uuid,uuid,text,integer,jsonb,text,jsonb,jsonb,text,timestamptz,text,text,timestamptz,text,text) to service_role;


-- The member token is rechecked under the same lock used by membership removal and recovery.
create function public.record_plan_member_vote_atomic(
  p_plan_id uuid, p_proposal_id uuid, p_member_id uuid, p_token_hash text,
  p_value text, p_idempotency_key text, p_vote_id uuid, p_created_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid;
  v_host uuid;
  v_member public.plan_crew_members%rowtype;
begin
  select social_owner_account_id into v_owner from public.plans where id=p_plan_id for update;
  if not found or v_owner is not null then return jsonb_build_object('code','not_found'); end if;
  select id into v_host from public.plan_crew_members where plan_id=p_plan_id
    and membership_revoked_at is null order by joined_at,id limit 1;
  select * into v_member from public.plan_crew_members where id=p_member_id and plan_id=p_plan_id
    and token_hash=p_token_hash and membership_revoked_at is null for share;
  if not found or (v_member.id is distinct from v_host and not coalesce(v_member.can_collaborate,false))
    then return jsonb_build_object('code','forbidden'); end if;
  return public.record_plan_vote_atomic(p_plan_id,p_proposal_id,p_member_id,p_value,p_idempotency_key,p_vote_id,p_created_at);
end;
$$;
revoke all on function public.record_plan_member_vote_atomic(uuid,uuid,uuid,text,text,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.record_plan_member_vote_atomic(uuid,uuid,uuid,text,text,text,uuid,timestamptz) to service_role;

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
  v_context jsonb;
  v_anchor text;
  v_anchor_source text;
  v_social_owner uuid;
  v_current_unresolved jsonb;
  v_stop_count integer;
begin
  if public._social_plan_is_bound(p_plan_id) then return 'not_found'; end if;
  if p_decision not in ('accepted', 'rejected') then return 'invalid'; end if;

  select route_revision,status,night_context,anchor_venue_id,anchor_source,social_owner_account_id
    into v_revision,v_status,v_context,v_anchor,v_anchor_source,v_social_owner
    from public.plans where id=p_plan_id for update;
  if not found or v_social_owner is not null then return 'not_found'; end if;

  select token_hash into v_host_hash
  from public.plan_crew_members
  where plan_id = p_plan_id and membership_revoked_at is null
  order by joined_at, id
  limit 1 for share;
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
    if v_status in ('completed','abandoned') then return 'invalid'; end if;
    if v_revision <> v_proposal.expected_route_revision then return 'conflict'; end if;
    if v_proposal.grounding_proof is not null and
      (v_proposal.grounding_expires_at is null or v_proposal.grounding_expires_at <= clock_timestamp()) then return 'expired'; end if;
    if v_anchor is not null and (
      v_proposal.grounding_proof is null
      or v_proposal.grounding_anchor_venue_id is distinct from v_anchor
      or v_proposal.grounding_anchor_source is distinct from v_anchor_source
      or v_proposal.stops->0->>'venueId' is distinct from v_anchor
    ) then return 'forbidden'; end if;
    if exists (
      select 1 from public.plan_stops s where s.plan_id=p_plan_id
        and s.position <= (select max(a.stop_position) from public.plan_actions a
          where a.plan_id=p_plan_id and a.type in ('arrived','skipped'))
        and not exists (select 1 from jsonb_array_elements(v_proposal.stops) item
          where item->>'venueId'=s.venue_id and item->>'position'=s.position::text)
    ) then return 'conflict'; end if;
    if v_stop_count not between 1 and 6 then return 'invalid'; end if;
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
      and not coalesce((
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
      ), false);
    update public.plan_route_proposals set unresolved_constraint_ids = v_current_unresolved where id = p_proposal_id;
    if jsonb_array_length(v_current_unresolved) > 0 then return 'constraints_unresolved'; end if;


    delete from public.plan_stops where plan_id = p_plan_id;
    insert into public.plan_stops (plan_id, venue_id, venue_name, position, selected_drink_price_evidence)
    select p_plan_id, item->>'venueId', item->>'venueName', (item->>'position')::integer,
      case
        when v_context->>'zeroProof' = 'true'
          or item->'selectedDrinkPriceEvidence'->>'category'
            is distinct from v_context->>'drinkCategory'
        then null
        else item->'selectedDrinkPriceEvidence'
      end
    from jsonb_array_elements(v_proposal.stops) item;
    update public.plans set route_revision = route_revision + 1,
      plan_outcome = case when anchor_venue_id is not null then 'route' else plan_outcome end,
      route_ready_at = case when anchor_venue_id is not null then coalesce(route_ready_at,now()) else route_ready_at end
      where id = p_plan_id;
  end if;

  update public.plan_route_proposals
  set status = p_decision, decision_idempotency_key = p_idempotency_key, decided_at = p_decided_at
  where id = p_proposal_id;
  return 'decided';
end;
$$;

-- The direct route editor keeps the same completed prefix.
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
  where member.plan_id = p_plan_id and member.membership_revoked_at is null
  order by member.joined_at, member.id
  limit 1 for share;
  if creator_id is null or not exists (
    select 1 from public.plan_crew_members
    where id = creator_id and token_hash = p_token_hash
  ) then return 'forbidden'; end if;

  if current_plan.status in ('completed', 'abandoned') then return 'invalid'; end if;
  if current_plan.route_revision <> p_expected_route_revision then return 'conflict'; end if;
  if jsonb_typeof(p_stops) <> 'array' or jsonb_array_length(p_stops) not between 1 and 6 then return 'invalid'; end if;
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

  if exists (
    select 1 from public.plan_stops s where s.plan_id=p_plan_id
      and s.position <= (select max(a.stop_position) from public.plan_actions a
        where a.plan_id=p_plan_id and a.type in ('arrived','skipped'))
      and not exists (select 1 from jsonb_array_elements(p_stops) with ordinality item(value, ordinality)
        where item.value->>'venueId'=s.venue_id and item.ordinality-1=s.position)
  ) then return 'conflict'; end if;

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
