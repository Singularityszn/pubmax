-- Atomic one-tap price pairing (0234) replaces hide-based compensation.
-- The Pint Drop carries the request figure, measure and evidence.
-- A newer stored observation answers superseded without minting a Pint Drop.
-- Reverse: rollback/20261110160000_0234_one_tap_price_pair_atomic_rollback.sql

begin;

create or replace function public.create_one_tap_price_pair_atomic(
  p_venue_id text,
  p_drink_category text,
  p_price_pennies integer,
  p_actor text,
  p_contributor_handle text,
  p_submitted_at timestamptz,
  p_drop jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price record;
  v_drop public.pint_drops%rowtype;
  v_drop_id uuid;
  v_drop_hash bytea;
  v_created boolean := true;
begin
  if p_actor is null or p_actor = '' or p_drink_category is distinct from 'beer'
    or p_submitted_at is null or p_price_pennies is null
    or p_drop->>'measure' is distinct from 'pint'
    or p_drop->>'venue_id' is distinct from p_venue_id
    or (p_drop->>'price_gbp')::numeric is distinct from p_price_pennies::numeric / 100
  then
    raise exception 'Invalid paired price request';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('round-price-actor:' || p_actor, 0)
  );

  select id, price_pennies, submitted_at into v_price
  from public.community_prices
  where venue_id = p_venue_id and drink_category = p_drink_category and actor = p_actor;

  if v_price.submitted_at > p_submitted_at then
    return pg_catalog.jsonb_build_object('status', 'superseded');
  end if;

  v_drop_hash := extensions.digest(pg_catalog.decode(pg_catalog.replace(v_price.id::text, '-', ''), 'hex') ||
    pg_catalog.convert_to((extract(epoch from p_submitted_at) * 1000)::bigint::text || ':' ||
      pg_catalog.trim_scale(p_price_pennies::numeric / 100)::text, 'UTF8'), 'sha1');
  v_drop_hash := pg_catalog.set_byte(v_drop_hash, 6, (pg_catalog.get_byte(v_drop_hash, 6) & 15) | 80);
  v_drop_hash := pg_catalog.set_byte(v_drop_hash, 8, (pg_catalog.get_byte(v_drop_hash, 8) & 63) | 128);
  v_drop_id := pg_catalog.encode(pg_catalog.substring(v_drop_hash, 1, 16), 'hex')::uuid;
  select * into v_drop from public.pint_drops where id = v_drop_id;
  if found then
    if v_drop.venue_id is distinct from p_venue_id
      or v_drop.handle is distinct from p_drop->>'handle'
      or v_drop.price_gbp is distinct from p_price_pennies::numeric / 100
      or v_drop.measure is distinct from p_drop->>'measure'
    then
      raise exception 'Pint Drop id already exists';
    end if;
    v_created := false;
  end if;

  if v_created and v_price.id is not null and v_price.price_pennies = p_price_pennies then
    v_drop_hash := extensions.digest(pg_catalog.decode(pg_catalog.replace(v_price.id::text, '-', ''), 'hex') ||
      pg_catalog.convert_to((extract(epoch from v_price.submitted_at) * 1000)::bigint::text || ':' ||
        pg_catalog.trim_scale(p_price_pennies::numeric / 100)::text, 'UTF8'), 'sha1');
    v_drop_hash := pg_catalog.set_byte(v_drop_hash, 6, (pg_catalog.get_byte(v_drop_hash, 6) & 15) | 80);
    v_drop_hash := pg_catalog.set_byte(v_drop_hash, 8, (pg_catalog.get_byte(v_drop_hash, 8) & 63) | 128);
    v_drop_id := pg_catalog.encode(pg_catalog.substring(v_drop_hash, 1, 16), 'hex')::uuid;
    select * into v_drop from public.pint_drops
    where id = v_drop_id and venue_id = p_venue_id
      and handle = p_drop->>'handle'
      and price_gbp = p_price_pennies::numeric / 100
      and measure = p_drop->>'measure'
      and created_at <= p_submitted_at
      and created_at >= p_submitted_at - interval '6 seconds';
    v_created := not found;
  end if;

  if v_created then
    select saved.id, saved.price_pennies, saved.submitted_at into v_price
    from public.upsert_attributed_community_price_if_newer(
      p_venue_id, p_drink_category, p_price_pennies, p_actor,
      p_contributor_handle, p_submitted_at, null, null
    ) saved;
    if v_price.id is null then
      raise exception 'Community price was not stored';
    end if;
    if v_price.submitted_at > p_submitted_at then
      return pg_catalog.jsonb_build_object('status', 'superseded');
    end if;

    v_drop := pg_catalog.jsonb_populate_record(null::public.pint_drops, p_drop);
    v_drop_hash := extensions.digest(pg_catalog.decode(pg_catalog.replace(v_price.id::text, '-', ''), 'hex') ||
      pg_catalog.convert_to((extract(epoch from p_submitted_at) * 1000)::bigint::text || ':' ||
        pg_catalog.trim_scale(p_price_pennies::numeric / 100)::text, 'UTF8'), 'sha1');
    v_drop_hash := pg_catalog.set_byte(v_drop_hash, 6, (pg_catalog.get_byte(v_drop_hash, 6) & 15) | 80);
    v_drop_hash := pg_catalog.set_byte(v_drop_hash, 8, (pg_catalog.get_byte(v_drop_hash, 8) & 63) | 128);
    v_drop.id := pg_catalog.encode(pg_catalog.substring(v_drop_hash, 1, 16), 'hex')::uuid;
    v_drop.price_gbp := p_price_pennies::numeric / 100;
    insert into public.pint_drops (
      id,
      venue_id,
      handle,
      drink,
      measure,
      measure_label,
      price_gbp,
      price_evidence,
      passed_down_note,
      era,
      vibe_tags,
      visibility,
      pint_photo_key,
      venue_photo_key,
      receipt_photo_key,
      provenance,
      status,
      created_at,
      authority_key,
      price_day,
      confirmation_id,
      confirmed_at,
      confirmation_basis,
      confirming_drop_id,
      reported_at,
      report_reason,
      report_count,
      moderated_at,
      moderator_note,
      leave_by_iso,
      last_train_decision
    ) values (
      v_drop.id,
      v_drop.venue_id,
      v_drop.handle,
      v_drop.drink,
      v_drop.measure,
      v_drop.measure_label,
      v_drop.price_gbp,
      v_drop.price_evidence,
      v_drop.passed_down_note,
      v_drop.era,
      v_drop.vibe_tags,
      v_drop.visibility,
      v_drop.pint_photo_key,
      v_drop.venue_photo_key,
      v_drop.receipt_photo_key,
      v_drop.provenance,
      v_drop.status,
      v_drop.created_at,
      v_drop.authority_key,
      v_drop.price_day,
      v_drop.confirmation_id,
      v_drop.confirmed_at,
      v_drop.confirmation_basis,
      v_drop.confirming_drop_id,
      v_drop.reported_at,
      v_drop.report_reason,
      v_drop.report_count,
      v_drop.moderated_at,
      v_drop.moderator_note,
      v_drop.leave_by_iso,
      v_drop.last_train_decision
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'saved',
    'created', v_created,
    'drop', pg_catalog.to_jsonb(v_drop),
    'price', pg_catalog.jsonb_build_object(
      'id', v_price.id,
      'venueId', p_venue_id,
      'drinkCategory', p_drink_category,
      'priceGbp', v_drop.price_gbp,
      'submittedAt', (extract(epoch from v_drop.created_at) * 1000)::bigint,
      'source', 'community'
    )
  );
end;
$$;

revoke all on function public.create_one_tap_price_pair_atomic(
  text, text, integer, text, text, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.create_one_tap_price_pair_atomic(
  text, text, integer, text, text, timestamptz, jsonb
) to service_role;

commit;
