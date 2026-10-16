-- Commit a Community Price and its public Pint Drop in one transaction.
-- This replaces the four-column Production RPC recorded in the repository
-- ledger. Its return type stays unchanged so PostgreSQL can apply the repair
-- without dropping the live function.

create or replace function public.create_one_tap_price_pair(
  p_venue_id text,
  p_drink_category text,
  p_price_pennies integer,
  p_actor text,
  p_contributor_handle text,
  p_submitted_at timestamptz,
  p_drop_id uuid,
  p_handle text,
  p_drink text,
  p_pint_photo_key text,
  p_venue_photo_key text,
  p_authority_key text
)
returns table (
  price_id uuid,
  price_pennies integer,
  submitted_at timestamptz,
  drop_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_price_id uuid;
  v_price_pennies integer;
  v_submitted_at timestamptz;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'Stable actor is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('round-price-actor:' || p_actor, 0)
  );

  if exists (
    select 1
    from public.community_prices existing
    where existing.venue_id = p_venue_id
      and existing.drink_category = p_drink_category
      and existing.actor = p_actor
      and existing.submitted_at >= p_submitted_at
  ) then
    raise exception 'Community Price observation was superseded';
  end if;

  select saved.id, saved.price_pennies, saved.submitted_at
    into v_price_id, v_price_pennies, v_submitted_at
  from public.upsert_attributed_community_price_if_newer(
    p_venue_id,
    p_drink_category,
    p_price_pennies,
    p_actor,
    p_contributor_handle,
    p_submitted_at,
    null,
    null
  ) saved;

  if
    v_price_id is null
    or v_price_pennies is distinct from p_price_pennies
    or v_submitted_at is distinct from p_submitted_at
  then
    raise exception 'Community Price observation did not win ownership';
  end if;

  insert into public.pint_drops (
    id,
    venue_id,
    handle,
    drink,
    price_gbp,
    passed_down_note,
    era,
    vibe_tags,
    visibility,
    pint_photo_key,
    venue_photo_key,
    provenance,
    status,
    created_at,
    authority_key
  ) values (
    p_drop_id,
    p_venue_id,
    p_handle,
    p_drink,
    v_price_pennies::numeric / 100,
    '',
    '',
    '{}',
    'public',
    p_pint_photo_key,
    p_venue_photo_key,
    'contributor',
    'visible',
    v_submitted_at,
    p_authority_key
  );

  return query select v_price_id, v_price_pennies, v_submitted_at, p_drop_id;
end;
$$;

revoke all on function public.create_one_tap_price_pair(
  text, text, integer, text, text, timestamptz, uuid, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_one_tap_price_pair(
  text, text, integer, text, text, timestamptz, uuid, text, text, text, text, text
) to service_role;

-- Resolve an ambiguous RPC response only after the writer's actor lock is
-- released. A row is returned only when every persisted pair field matches the
-- attempted observation, including the object keys that may need cleanup.
create or replace function public.recover_one_tap_price_pair(
  p_drop_id uuid,
  p_actor text,
  p_venue_id text,
  p_drink_category text,
  p_price_pennies integer,
  p_submitted_at timestamptz,
  p_authority_key text,
  p_pint_photo_key text,
  p_venue_photo_key text
)
returns table (
  price_id uuid,
  price_pennies integer,
  submitted_at timestamptz,
  drop_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_actor is null or btrim(p_actor) = '' then
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('round-price-actor:' || p_actor, 0)
  );

  return query
  select
    price.id,
    price.price_pennies,
    price.submitted_at,
    drop_row.id
  from public.pint_drops drop_row
  join public.community_prices price
    on price.venue_id = drop_row.venue_id
   and price.actor = p_actor
   and price.drink_category = p_drink_category
   and price.price_pennies = p_price_pennies
   and price.submitted_at = p_submitted_at
  where drop_row.id = p_drop_id
    and drop_row.venue_id = p_venue_id
    and round(drop_row.price_gbp * 100)::integer = p_price_pennies
    and drop_row.created_at = p_submitted_at
    and drop_row.authority_key is not distinct from p_authority_key
    and drop_row.pint_photo_key is not distinct from p_pint_photo_key
    and drop_row.venue_photo_key is not distinct from p_venue_photo_key
    and drop_row.provenance = 'contributor'
    and drop_row.status = 'visible'
    and drop_row.visibility = 'public';
end;
$$;

revoke all on function public.recover_one_tap_price_pair(
  uuid, text, text, text, integer, timestamptz, text, text, text
) from public, anon, authenticated;
grant execute on function public.recover_one_tap_price_pair(
  uuid, text, text, text, integer, timestamptz, text, text, text
) to service_role;
