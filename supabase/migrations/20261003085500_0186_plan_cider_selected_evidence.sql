-- Admit exact named listed Cider evidence under its explicit current choice.
-- Storage shape only: the existing API corroborates venue/menu authority.
-- Unknown serving never becomes a pint or a comparable volume.
-- Every category's evidence also follows the current named subtype and measure.
-- Existing create delegate, non-Cider rows and permission surfaces stay intact.
-- Captain applies; rollback refuses active Cider primary or backup evidence.

begin;

alter table public.plan_stops
  drop constraint plan_stops_selected_drink_price_evidence_check;

alter table public.plan_stops
  add constraint plan_stops_selected_drink_price_evidence_check
  check (
    selected_drink_price_evidence is null or (
      jsonb_typeof(selected_drink_price_evidence) = 'object'
      and jsonb_typeof(selected_drink_price_evidence->'category') = 'string'
      and selected_drink_price_evidence->>'category' in (
        'beer', 'wine', 'whisky', 'gin', 'vodka', 'rum', 'cocktail', 'shot',
        'alcohol-free', 'soft-drink', 'coffee', 'other'
      )
      and (
        selected_drink_price_evidence->>'category' <> 'beer'
        or (
          selected_drink_price_evidence->>'source' = 'listed'
          and selected_drink_price_evidence->>'drinkSubtype' = 'beer-cider'
          and selected_drink_price_evidence ?& array['drinkLabel', 'drinkSubtype']
        )
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
                    'beer-cider', 'wine-sparkling', 'wine-rose', 'wine-white', 'wine-red', 'wine-fortified',
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
  with slots as (
    select p_stop as stop, 0::bigint as ordinal, false as backup
    union all
    select item, ordinal, true
    from jsonb_array_elements(coalesce(p_stop->'alternatives', '[]'::jsonb))
      with ordinality as alternatives(item, ordinal)
  ), filtered as (
    select ordinal, backup,
      case when (
        p_context is not null and (
          p_context->>'zeroProof' = 'true'
          or stop->'selectedDrinkPriceEvidence'->>'category' is distinct from p_context->>'drinkCategory'
          or (
            p_context->>'drinkSubtype' is not null
            and (
              stop->'selectedDrinkPriceEvidence'->>'source' is distinct from 'listed'
              or not (stop->'selectedDrinkPriceEvidence' ? 'drinkLabel')
              or (
                stop->'selectedDrinkPriceEvidence'->>'drinkSubtype' = p_context->>'drinkSubtype'
                or (
                  p_context->>'drinkSubtype' = 'soft-drink-zero-sugar-cola'
                  and stop->'selectedDrinkPriceEvidence'->>'drinkSubtype' in (
                    'soft-drink-coke-zero', 'soft-drink-diet-coke', 'soft-drink-pepsi-max', 'soft-drink-diet-pepsi'
                  )
                )
              ) is not true
            )
          )
          or (
            p_context->>'drinkServing' is not null
            and (
              stop->'selectedDrinkPriceEvidence'->>'source' is distinct from 'listed'
              or case
                when stop->'selectedDrinkPriceEvidence'->>'category' = 'beer'
                  and lower(btrim(stop->'selectedDrinkPriceEvidence'->>'serving')) = 'pint' then 'pint'
                when lower(btrim(stop->'selectedDrinkPriceEvidence'->>'serving'))
                  ~ '^[1-9][0-9]{0,3}[[:space:]]*ml([[:space:]]+(glass|shot))?$'
                then (substring(lower(btrim(stop->'selectedDrinkPriceEvidence'->>'serving'))
                  from '^[1-9][0-9]{0,3}')::integer)::text || 'ml'
                else null
              end is distinct from p_context->>'drinkServing'
            )
          )
        )
      ) or (
        stop->'selectedDrinkPriceEvidence'->>'category' = 'beer'
        and (
          p_context is not null
          and p_context->>'drinkCategory' = 'beer'
          and p_context->>'drinkSubtype' = 'beer-cider'
          and stop->'selectedDrinkPriceEvidence'->>'source' = 'listed'
          and stop->'selectedDrinkPriceEvidence'->>'drinkSubtype' = 'beer-cider'
          and stop->'selectedDrinkPriceEvidence' ?& array[
            'category', 'pence', 'serving', 'source', 'sourceUrl', 'observedAt', 'drinkLabel', 'drinkSubtype'
          ]
          and (stop->'selectedDrinkPriceEvidence') - array[
            'category', 'pence', 'serving', 'source', 'sourceUrl', 'observedAt', 'drinkLabel', 'drinkSubtype'
          ] = '{}'::jsonb
          and jsonb_typeof(stop->'selectedDrinkPriceEvidence'->'drinkLabel') = 'string'
        ) is not true
      ) then stop - 'selectedDrinkPriceEvidence' else stop end as stop
    from slots
  )
  select (select stop from filtered where not backup)
    || jsonb_build_object('alternatives', coalesce((
      select jsonb_agg(stop order by ordinal) from filtered where backup
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
  filtered_stops jsonb := p_stops;
begin
  -- Keep invalid/non-array inputs on the original atomic delegate path.
  -- Only remove Cider evidence when the existing context helper refuses it;
  -- all non-Cider evidence and the original stop/backup shape stay literal.
  if jsonb_typeof(p_stops) = 'array' then
    select coalesce(jsonb_agg(
      case when safe.can_filter then
        (case when item.value->'selectedDrinkPriceEvidence'->>'category' = 'beer'
          and item.value->'selectedDrinkPriceEvidence'->>'drinkSubtype' = 'beer-cider'
          and not (filtered.stop ? 'selectedDrinkPriceEvidence')
        then item.value - 'selectedDrinkPriceEvidence' else item.value end)
        || case when item.value ? 'alternatives' then jsonb_build_object('alternatives', (
          select coalesce(jsonb_agg(case
            when backup.value->'selectedDrinkPriceEvidence'->>'category' = 'beer'
              and backup.value->'selectedDrinkPriceEvidence'->>'drinkSubtype' = 'beer-cider'
              and not ((filtered.stop->'alternatives'->(backup.ordinality - 1)::integer) ? 'selectedDrinkPriceEvidence')
            then backup.value - 'selectedDrinkPriceEvidence' else backup.value end
            order by backup.ordinality), '[]'::jsonb)
          from jsonb_array_elements(item.value->'alternatives') with ordinality as backup(value, ordinality)
        )) else '{}'::jsonb end
      else item.value end order by item.ordinality
    ), '[]'::jsonb) into filtered_stops
    from jsonb_array_elements(p_stops) with ordinality as item(value, ordinality)
    cross join lateral (
      select case when jsonb_typeof(item.value) = 'object' then
        case when not (item.value ? 'alternatives') then true
          when jsonb_typeof(item.value->'alternatives') = 'array' then not exists (
            select 1 from jsonb_array_elements(item.value->'alternatives') backup
            where jsonb_typeof(backup) <> 'object'
          )
          else false end
        else false end as can_filter
    ) safe
    cross join lateral (
      select case when safe.can_filter
        then public.plan_stop_evidence_for_context(item.value, p_context)
        else item.value end as stop
    ) filtered;
  end if;
  create_result := public.create_plan_idempotent_atomic(
    p_id,
    p_title,
    p_start_time,
    filtered_stops,
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
