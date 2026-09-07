-- Keep a bill attached to the price accepted by the newer-wins upsert.
-- Existing rows and eight-argument callers have no receipt key.
-- The old overload must go: its signature conflicts with the defaulted argument.
-- Receipt keys remain service-role-only, like the observation actor.

begin;

alter table public.community_prices
  add column if not exists receipt_photo_key text;

comment on column public.community_prices.receipt_photo_key is
  'Private Storage key for the bill behind this price observation.';

drop function if exists public.upsert_attributed_community_price_if_newer(
  text, text, integer, text, text, timestamptz, uuid, integer
);

create or replace function public.upsert_attributed_community_price_if_newer(
  p_venue_id text,
  p_drink_category text,
  p_price_pennies integer,
  p_actor text,
  p_contributor_handle text,
  p_submitted_at timestamptz,
  p_round_spend_id uuid,
  p_round_line_index integer,
  p_receipt_photo_key text default null
)
returns table (
  id uuid,
  price_pennies integer,
  submitted_at timestamptz,
  round_spend_id uuid,
  round_line_index integer,
  source_became_owner boolean,
  receipt_photo_key text,
  replaced_receipt_photo_key text,
  write_applied boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_receipt_key text;
  v_current_receipt_key text;
  v_write_applied boolean := false;
  v_old_spend_id uuid;
  v_old_line_index integer;
  v_current_id uuid;
  v_current_pennies integer;
  v_current_submitted_at timestamptz;
  v_current_spend_id uuid;
  v_current_line_index integer;
  v_source_round_id uuid;
  v_source_venue_id text;
  v_source_item jsonb;
  v_candidate_spend_id uuid;
  v_candidate_line_index integer;
begin
  if
    nullif(trim(p_actor), '') is null
    or (
      (p_round_spend_id is null) is distinct from
      (p_round_line_index is null)
    )
    or coalesce(p_round_line_index, 0) < 0
  then
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('round-price-actor:' || p_actor, 0)
  );

  if p_round_spend_id is not null then
    select
      source.round_id,
      source.venue_id,
      source.items->p_round_line_index
    into
      v_source_round_id,
      v_source_venue_id,
      v_source_item
    from public.round_spends source
    where source.id = p_round_spend_id
      and source.promotion_actor = p_actor
      and jsonb_array_length(source.items) > p_round_line_index
    for update;

    if
      not found
      or v_source_venue_id is distinct from p_venue_id
      or v_source_item->>'source' is distinct from 'round'
      or v_source_item->>'drinkCategory' is distinct from p_drink_category
    then
      return;
    end if;

    if v_source_item->>'promotionStatus' = 'promoted' then
      select
        existing.id,
        existing.price_pennies,
        existing.submitted_at,
        existing.round_spend_id,
        existing.round_line_index,
        existing.receipt_photo_key
      into
        v_current_id,
        v_current_pennies,
        v_current_submitted_at,
        v_current_spend_id,
        v_current_line_index,
        v_current_receipt_key
      from public.community_prices existing
      where existing.venue_id = p_venue_id
        and existing.drink_category = p_drink_category
        and existing.actor = p_actor
      for update;

      if
        not found
        or v_current_spend_id is distinct from p_round_spend_id
        or v_current_line_index is distinct from p_round_line_index
      then
        return;
      end if;

      return query
      select
        v_current_id,
        v_current_pennies,
        v_current_submitted_at,
        v_current_spend_id,
        v_current_line_index,
        true as source_became_owner,
        v_current_receipt_key,
        null::text,
        false;
      return;
    end if;

    if v_source_item->>'promotionStatus' is distinct from 'ready' then
      return;
    end if;

    perform 1
      from public.round_spends candidate
     where candidate.round_id = v_source_round_id
       and candidate.promotion_actor = p_actor
     for update;

    select
      candidate.id,
      (expanded.ordinality - 1)::integer
    into
      v_candidate_spend_id,
      v_candidate_line_index
    from public.round_spends candidate
    cross join lateral jsonb_array_elements(candidate.items)
      with ordinality as expanded(item, ordinality)
    where candidate.round_id = v_source_round_id
      and candidate.promotion_actor = p_actor
      and candidate.venue_id = p_venue_id
      and expanded.item->>'source' = 'round'
      and expanded.item->>'drinkCategory' = p_drink_category
      and expanded.item->>'promotionStatus' in ('pending', 'ready')
    order by
      candidate.recorded_at desc,
      candidate.id::text desc,
      expanded.ordinality desc
    limit 1;

    if
      v_candidate_spend_id is distinct from p_round_spend_id
      or v_candidate_line_index is distinct from p_round_line_index
    then
      return;
    end if;
  end if;

  select existing.round_spend_id, existing.round_line_index, existing.receipt_photo_key
    into v_old_spend_id, v_old_line_index, v_old_receipt_key
    from public.community_prices existing
   where existing.venue_id = p_venue_id
     and existing.drink_category = p_drink_category
     and existing.actor = p_actor
   for update;

  insert into public.community_prices (
    venue_id,
    drink_category,
    price_pennies,
    actor,
    contributor_handle,
    submitted_at,
    round_spend_id,
    round_line_index,
    receipt_photo_key
  )
  values (
    p_venue_id,
    p_drink_category,
    p_price_pennies,
    p_actor,
    p_contributor_handle,
    p_submitted_at,
    p_round_spend_id,
    p_round_line_index,
    p_receipt_photo_key
  )
  on conflict (venue_id, drink_category, actor)
  do update
     set price_pennies = excluded.price_pennies,
         contributor_handle = excluded.contributor_handle,
         submitted_at = excluded.submitted_at,
         round_spend_id = excluded.round_spend_id,
         round_line_index = excluded.round_line_index,
         receipt_photo_key = excluded.receipt_photo_key
   where public.community_prices.submitted_at <= excluded.submitted_at
  returning
    public.community_prices.id,
    public.community_prices.price_pennies,
    public.community_prices.submitted_at,
    public.community_prices.round_spend_id,
    public.community_prices.round_line_index,
    public.community_prices.receipt_photo_key
  into
    v_current_id,
    v_current_pennies,
    v_current_submitted_at,
    v_current_spend_id,
    v_current_line_index,
    v_current_receipt_key;

  v_write_applied := found;
  if not v_write_applied then
    select
      existing.id,
      existing.price_pennies,
      existing.submitted_at,
      existing.round_spend_id,
      existing.round_line_index,
      existing.receipt_photo_key
    into
      v_current_id,
      v_current_pennies,
      v_current_submitted_at,
      v_current_spend_id,
      v_current_line_index,
      v_current_receipt_key
    from public.community_prices existing
    where existing.venue_id = p_venue_id
      and existing.drink_category = p_drink_category
      and existing.actor = p_actor;
  end if;

  if
    v_old_spend_id is not null
    and (
      v_old_spend_id is distinct from v_current_spend_id
      or v_old_line_index is distinct from v_current_line_index
    )
  then
    update public.round_spends spend
       set items = jsonb_set(
         spend.items,
         array[v_old_line_index::text, 'promotionStatus'],
         to_jsonb('superseded'::text),
         false
       )
     where spend.id = v_old_spend_id
       and spend.promotion_actor = p_actor
       and jsonb_array_length(spend.items) > v_old_line_index
       and spend.items->v_old_line_index->>'source' = 'round';
  end if;

  if p_round_spend_id is not null then
    update public.round_spends spend
       set items = jsonb_set(
         spend.items,
         array[p_round_line_index::text, 'promotionStatus'],
         to_jsonb(
           (
             case
               when
                 v_current_spend_id is not distinct from p_round_spend_id
                 and v_current_line_index is not distinct from p_round_line_index
               then 'promoted'
               else 'superseded'
             end
           )::text
         ),
         false
       )
     where spend.id = p_round_spend_id
       and spend.promotion_actor = p_actor
       and jsonb_array_length(spend.items) > p_round_line_index
       and spend.items->p_round_line_index->>'source' = 'round'
       and spend.items->p_round_line_index->>'promotionStatus'
         in ('ready', 'promoted');
  end if;

  return query
  select
    v_current_id,
    v_current_pennies,
    v_current_submitted_at,
    v_current_spend_id,
    v_current_line_index,
    v_current_spend_id is not distinct from p_round_spend_id
      and v_current_line_index is not distinct from p_round_line_index,
    v_current_receipt_key,
    case when v_write_applied then v_old_receipt_key else null::text end,
    v_write_applied;
end;
$$;

revoke all on function public.upsert_attributed_community_price_if_newer(
  text,
  text,
  integer,
  text,
  text,
  timestamptz,
  uuid,
  integer,
  text
) from public, anon, authenticated;
grant execute on function public.upsert_attributed_community_price_if_newer(
  text,
  text,
  integer,
  text,
  text,
  timestamptz,
  uuid,
  integer,
  text
) to service_role;

commit;
