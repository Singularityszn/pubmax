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
    )
  );
