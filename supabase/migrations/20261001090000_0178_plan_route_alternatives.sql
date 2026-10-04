-- Save server-canonical backup identities and revalidated quotations, without widening readers.
-- Run 0179 rollback before this twin; column removal discards saved backups.
begin;
alter table public.plan_stops
  add column alternatives jsonb not null default '[]'::jsonb
  constraint plan_stops_alternatives_bounded check (
    jsonb_typeof(alternatives) = 'array' and jsonb_array_length(alternatives) <= 24
  );

create or replace function public.create_plan_idempotent_atomic(
  p_id uuid,
  p_title text,
  p_start_time timestamptz,
  p_stops jsonb,
  p_member_id uuid,
  p_member_name text,
  p_token_hash text,
  p_joined_at timestamptz,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_anchor_venue_id text default null,
  p_anchor_source text default null,
  p_outcome text default null
) returns text
language plpgsql security invoker set search_path = public
as $$
declare existing_plan public.plans%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('plan:create:' || p_idempotency_key_hash, 0));
  select * into existing_plan from public.plans where creation_key_hash = p_idempotency_key_hash for update;
  if found then
    if existing_plan.creation_request_hash = p_request_hash and existing_plan.id = p_id then return 'replayed'; end if;
    return 'conflict';
  end if;

  insert into public.plans
    (id, title, start_time, creation_key_hash, creation_request_hash, anchor_venue_id, anchor_source, plan_outcome, route_ready_at)
  values (
    p_id, p_title, p_start_time, p_idempotency_key_hash, p_request_hash,
    p_anchor_venue_id, p_anchor_source, p_outcome,
    case when p_outcome = 'route' then now() else null end
  );
  insert into public.plan_stops (plan_id, venue_id, venue_name, position, selected_drink_price_evidence, alternatives)
  select p_id, item.value->>'venueId', item.value->>'venueName', item.ordinality - 1,
    item.value->'selectedDrinkPriceEvidence', coalesce(item.value->'alternatives', '[]'::jsonb)
  from jsonb_array_elements(p_stops) with ordinality as item(value, ordinality);
  insert into public.plan_crew_members (id, plan_id, name, token_hash, status, joined_at, updated_at, can_collaborate)
  values (p_member_id, p_id, p_member_name, p_token_hash, 'in', p_joined_at, p_joined_at, true);
  return 'created';
end;
$$;

commit;
