-- Per-stop selected drink price evidence for saved Plans (0161).
-- Nullable for existing plans and stops without current, grounded evidence.
-- The API resolves venue/category authority before writing. This column carries
-- only the public display facts, never a contributor or private report field.

alter table public.plan_stops
  add column selected_drink_price_evidence jsonb;

alter table public.plan_stops
  add constraint plan_stops_selected_drink_price_evidence_check
  check (
    selected_drink_price_evidence is null or (
      jsonb_typeof(selected_drink_price_evidence) = 'object'
      and octet_length(selected_drink_price_evidence::text) <= 512
      and selected_drink_price_evidence ?& array['category', 'pence', 'serving', 'source', 'reportedAt']
      and selected_drink_price_evidence - array['category', 'pence', 'serving', 'source', 'reportedAt'] = '{}'::jsonb
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
      and selected_drink_price_evidence->'serving' = 'null'::jsonb
      and selected_drink_price_evidence->'source' = '"community"'::jsonb
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
    ) is true
  );
