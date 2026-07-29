create or replace function public.reconcile_round_price_keys(
  p_spend_id uuid,
  p_actor text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner text;
  v_round_id uuid;
begin
  if nullif(trim(p_actor), '') is null then
    return 'forbidden';
  end if;

  select round_id, promotion_actor
    into v_round_id, v_owner
    from public.round_spends
   where id = p_spend_id;

  if not found then
    return 'not_found';
  end if;

  if v_owner is distinct from p_actor then
    return 'forbidden';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'round-price-key:' || v_round_id::text || ':' || p_actor,
      0
    )
  );

  perform 1
    from public.round_spends
   where round_id = v_round_id
     and promotion_actor = p_actor
   for update;

  with ranked as materialized (
    select
      spend.id as spend_id,
      expanded.item,
      expanded.ordinality,
      row_number() over (
        partition by spend.venue_id, expanded.item->>'drinkCategory'
        order by
          spend.recorded_at desc,
          spend.id::text desc,
          expanded.ordinality desc
      ) as ownership_rank
    from public.round_spends spend
    cross join lateral jsonb_array_elements(spend.items)
      with ordinality as expanded(item, ordinality)
    where spend.round_id = v_round_id
      and spend.promotion_actor = p_actor
      and expanded.item->>'source' = 'round'
  ),
  rebuilt as (
    select
      spend_id,
      jsonb_agg(
        case
          when ownership_rank > 1
            then jsonb_set(
              item,
              '{promotionStatus}',
              to_jsonb('superseded'::text),
              true
            )
          else item
        end
        order by ordinality
      ) as items
    from ranked
    group by spend_id
  )
  update public.round_spends spend
     set items = rebuilt.items
    from rebuilt
   where spend.id = rebuilt.spend_id;

  return 'ok';
end;
$$;

revoke all on function public.reconcile_round_price_keys(
  uuid,
  text
) from public, anon, authenticated;
grant execute on function public.reconcile_round_price_keys(
  uuid,
  text
) to service_role;

create or replace function public.upsert_attributed_community_price_if_newer(
  p_venue_id text,
  p_drink_category text,
  p_price_pennies integer,
  p_actor text,
  p_contributor_handle text,
  p_submitted_at timestamptz
)
returns table (
  id uuid,
  price_pennies integer,
  submitted_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  insert into public.community_prices (
    venue_id,
    drink_category,
    price_pennies,
    actor,
    contributor_handle,
    submitted_at
  )
  values (
    p_venue_id,
    p_drink_category,
    p_price_pennies,
    p_actor,
    p_contributor_handle,
    p_submitted_at
  )
  on conflict (venue_id, drink_category, actor)
  do update
     set price_pennies = excluded.price_pennies,
         contributor_handle = excluded.contributor_handle,
         submitted_at = excluded.submitted_at
   where public.community_prices.submitted_at <= excluded.submitted_at
  returning
    public.community_prices.id,
    public.community_prices.price_pennies,
    public.community_prices.submitted_at;

  if found then
    return;
  end if;

  return query
  select
    existing.id,
    existing.price_pennies,
    existing.submitted_at
  from public.community_prices existing
  where existing.venue_id = p_venue_id
    and existing.drink_category = p_drink_category
    and existing.actor = p_actor;
end;
$$;

revoke all on function public.upsert_attributed_community_price_if_newer(
  text,
  text,
  integer,
  text,
  text,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.upsert_attributed_community_price_if_newer(
  text,
  text,
  integer,
  text,
  text,
  timestamptz
) to service_role;
