-- Admit named menu identity alongside legacy selected-price evidence.
-- Shape only; the API still corroborates the canonical current menu quote.

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

commit;
