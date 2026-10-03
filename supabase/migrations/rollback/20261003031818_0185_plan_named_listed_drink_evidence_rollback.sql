-- Restore the 0176 CHECK without deleting named evidence.
-- Refuse while active or pending-proposal named rows remain. Backup, decided
-- proposal and completion snapshots retain their identity; an older
-- application may omit those fields.

begin;

do $$
begin
  if exists (
    select 1 from public.plan_stops
    where selected_drink_price_evidence ?| array['drinkLabel', 'drinkSubtype']
  ) or exists (
    select 1 from public.plan_route_proposals proposal
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(proposal.stops) = 'array' then proposal.stops else '[]'::jsonb end
    ) stop
    where proposal.status = 'pending'
      and stop->'selectedDrinkPriceEvidence' ?| array['drinkLabel', 'drinkSubtype']
  ) then
    raise exception 'Named selected-price rows remain; explicit data rollback required';
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
          and selected_drink_price_evidence - array['category', 'pence', 'serving', 'source', 'sourceUrl', 'observedAt'] = '{}'::jsonb
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

commit;
