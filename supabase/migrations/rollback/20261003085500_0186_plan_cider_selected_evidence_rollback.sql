-- Restore the literal pre-0186 CHECK, context helper and creation wrapper.
-- Refuse active or pending-proposal Cider primary/backup evidence before any catalog change.
-- No row, proposal receipt or immutable completion snapshot is erased.
-- Downgrading active evidence needs an explicit captain data decision first.

begin;

-- ALTER needs this same lock. Take it before reading the refusal guard so an
-- uncommitted backup writer cannot become invisible evidence we then retain.
lock table public.plan_route_proposals in share mode;
lock table public.plan_stops in access exclusive mode;

do $$
begin
  if exists (
    select 1 from public.plan_stops stop
    where stop.selected_drink_price_evidence->>'category' = 'beer'
      and stop.selected_drink_price_evidence->>'drinkSubtype' = 'beer-cider'
  ) or exists (
    select 1 from public.plan_stops stop
    cross join lateral jsonb_array_elements(stop.alternatives) backup
    where backup->'selectedDrinkPriceEvidence'->>'category' = 'beer'
      and backup->'selectedDrinkPriceEvidence'->>'drinkSubtype' = 'beer-cider'
  ) or exists (
    select 1 from public.plan_route_proposals proposal
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(proposal.stops) = 'array' then proposal.stops else '[]'::jsonb end
    ) stop
    where proposal.status = 'pending'
      and (
        (
          stop->'selectedDrinkPriceEvidence'->>'category' = 'beer'
          and stop->'selectedDrinkPriceEvidence'->>'drinkSubtype' = 'beer-cider'
        ) or exists (
          select 1 from jsonb_array_elements(
            case when jsonb_typeof(stop->'alternatives') = 'array' then stop->'alternatives' else '[]'::jsonb end
          ) backup
          where backup->'selectedDrinkPriceEvidence'->>'category' = 'beer'
            and backup->'selectedDrinkPriceEvidence'->>'drinkSubtype' = 'beer-cider'
        )
      )
  ) then
    raise exception 'Cider selected-price rows remain; explicit data rollback required';
  end if;
end;
$$;

alter table public.plan_stops
  drop constraint plan_stops_selected_drink_price_evidence_check;

alter table public.plan_stops
  add constraint plan_stops_selected_drink_price_evidence_check
  check (
    selected_drink_price_evidence is null or (
      jsonb_typeof(selected_drink_price_evidence) = 'object'
      and jsonb_typeof(selected_drink_price_evidence->'category') = 'string'
      and selected_drink_price_evidence->>'category' in (
        'wine', 'whisky', 'gin', 'vodka', 'rum', 'cocktail', 'shot',
        'alcohol-free', 'soft-drink', 'coffee', 'other'
      )
      and case
        when jsonb_typeof(selected_drink_price_evidence->'pence') = 'number'
          and selected_drink_price_evidence->>'pence' ~ '^[1-9][0-9]*$'
        then (selected_drink_price_evidence->>'pence')::numeric between 1 and 100000
        else false
      end
      and case selected_drink_price_evidence->>'source'
        when 'community' then (
          octet_length(selected_drink_price_evidence::text) <= 512
          and selected_drink_price_evidence ?& array['category', 'pence', 'serving', 'source', 'reportedAt']
          and selected_drink_price_evidence - array['category', 'pence', 'serving', 'source', 'reportedAt'] = '{}'::jsonb
          and selected_drink_price_evidence->'serving' = 'null'::jsonb
          and jsonb_typeof(selected_drink_price_evidence->'reportedAt') = 'string'
          and case
            when selected_drink_price_evidence->>'reportedAt' ~
              '^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$'
            then to_char(
              (selected_drink_price_evidence->>'reportedAt')::timestamptz at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ) = selected_drink_price_evidence->>'reportedAt'
            else false
          end
        )
        when 'listed' then (
          octet_length(selected_drink_price_evidence::text) <= 12288
          and selected_drink_price_evidence ?& array['category', 'pence', 'serving', 'source', 'sourceUrl', 'observedAt']
          and (
            selected_drink_price_evidence - array['category', 'pence', 'serving', 'source', 'sourceUrl', 'observedAt'] = '{}'::jsonb
            or (
              selected_drink_price_evidence ?& array['drinkLabel', 'drinkSubtype']
              and selected_drink_price_evidence - array['category', 'pence', 'serving', 'source', 'sourceUrl', 'observedAt', 'drinkLabel', 'drinkSubtype'] = '{}'::jsonb
              and jsonb_typeof(selected_drink_price_evidence->'drinkLabel') = 'string'
              and char_length(selected_drink_price_evidence->>'drinkLabel') between 1 and 80
              and btrim(selected_drink_price_evidence->>'drinkLabel') = selected_drink_price_evidence->>'drinkLabel'
              and selected_drink_price_evidence->>'drinkLabel' !~ '[[:cntrl:]]'
              and (
                selected_drink_price_evidence->'drinkSubtype' = 'null'::jsonb
                or (
                  jsonb_typeof(selected_drink_price_evidence->'drinkSubtype') = 'string'
                  and left(selected_drink_price_evidence->>'drinkSubtype', char_length(selected_drink_price_evidence->>'category') + 1)
                    = (selected_drink_price_evidence->>'category') || '-'
                  and selected_drink_price_evidence->>'drinkSubtype' in (
                    'wine-sparkling', 'wine-rose', 'wine-white', 'wine-red', 'wine-fortified',
                    'whisky-single-malt', 'whisky-bourbon', 'whisky-irish', 'whisky-japanese', 'whisky-rye', 'whisky-scotch',
                    'gin-london-dry', 'gin-old-tom', 'gin-navy-strength', 'gin-sloe', 'gin-flavoured',
                    'vodka-flavoured', 'vodka-potato', 'vodka-grain',
                    'rum-white', 'rum-dark', 'rum-spiced', 'rum-aged', 'rum-overproof',
                    'cocktail-spritz', 'cocktail-martini', 'cocktail-sour', 'cocktail-highball', 'cocktail-tiki', 'cocktail-classic',
                    'shot-tequila', 'shot-sambuca', 'shot-herbal', 'shot-liqueur',
                    'soft-drink-coke-zero', 'soft-drink-diet-coke', 'soft-drink-pepsi-max', 'soft-drink-diet-pepsi',
                    'soft-drink-still-water', 'soft-drink-zero-sugar-cola'
                  )
                )
              )
            )
          )
          and (
            selected_drink_price_evidence->'serving' = 'null'::jsonb
            or (
              jsonb_typeof(selected_drink_price_evidence->'serving') = 'string'
              and char_length(selected_drink_price_evidence->>'serving') between 1 and 48
              and btrim(selected_drink_price_evidence->>'serving') = selected_drink_price_evidence->>'serving'
              and selected_drink_price_evidence->>'serving' !~ '[[:cntrl:]]'
            )
          )
          and jsonb_typeof(selected_drink_price_evidence->'sourceUrl') = 'string'
          and char_length(selected_drink_price_evidence->>'sourceUrl') <= 2048
          and selected_drink_price_evidence->>'sourceUrl' ~ '^https?://[^/@[:space:]]+([/?#][^[:space:]]*)?$'
          and selected_drink_price_evidence->>'sourceUrl' !~ '[[:cntrl:]]'
          and jsonb_typeof(selected_drink_price_evidence->'observedAt') = 'string'
          and case
            when selected_drink_price_evidence->>'observedAt' ~
              '^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$'
            then to_char(
              (selected_drink_price_evidence->>'observedAt')::timestamptz at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ) = selected_drink_price_evidence->>'observedAt'
            else false
          end
        )
        else false
      end
    ) is true
  );

create or replace function public.plan_stop_evidence_for_context(p_stop jsonb, p_context jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select
    (case when p_context is not null and (
      p_context->>'zeroProof' = 'true'
      or p_stop->'selectedDrinkPriceEvidence'->>'category' is distinct from p_context->>'drinkCategory'
    ) then p_stop - 'selectedDrinkPriceEvidence' else p_stop end)
    || jsonb_build_object('alternatives', coalesce((
      select jsonb_agg(case when p_context is not null and (
        p_context->>'zeroProof' = 'true'
        or item->'selectedDrinkPriceEvidence'->>'category' is distinct from p_context->>'drinkCategory'
      ) then item - 'selectedDrinkPriceEvidence' else item end order by ordinal)
      from jsonb_array_elements(coalesce(p_stop->'alternatives', '[]'::jsonb)) with ordinality as backup(item, ordinal)
    ), '[]'::jsonb));
$$;
revoke all on function public.plan_stop_evidence_for_context(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.plan_stop_evidence_for_context(jsonb,jsonb) to service_role;

create or replace function public.create_plan_with_context_idempotent_atomic(
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
  p_anchor_venue_id text,
  p_anchor_source text,
  p_outcome text,
  p_context jsonb
) returns text
language plpgsql security invoker set search_path = public
as $$
declare
  create_result text;
begin
  create_result := public.create_plan_idempotent_atomic(
    p_id,
    p_title,
    p_start_time,
    p_stops,
    p_member_id,
    p_member_name,
    p_token_hash,
    p_joined_at,
    p_idempotency_key_hash,
    p_request_hash,
    p_anchor_venue_id,
    p_anchor_source,
    p_outcome
  );

  -- A replay is not a second creation: the Plan already carries its context,
  -- may since have been adopted by a Social crew, and may have had its context
  -- edited. Only a genuine creation stamps one.
  if create_result <> 'created' or p_context is null then
    return create_result;
  end if;

  update public.plans
  set night_context = p_context
  where id = p_id
    and creation_key_hash = p_idempotency_key_hash
    and creation_request_hash = p_request_hash
    and social_owner_account_id is null;

  if not found then
    raise exception 'plan context write failed';
  end if;

  return create_result;
end;
$$;

revoke all on function public.create_plan_with_context_idempotent_atomic(uuid,text,timestamptz,jsonb,uuid,text,text,timestamptz,text,text,text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.create_plan_with_context_idempotent_atomic(uuid,text,timestamptz,jsonb,uuid,text,text,timestamptz,text,text,text,text,text,jsonb)
  to service_role;

commit;
