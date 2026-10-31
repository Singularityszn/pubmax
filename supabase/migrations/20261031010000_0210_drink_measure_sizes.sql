-- Glass and spirit sizes for a logged price (launch review item B1).
--
-- What was asked, on the launch review of 30 Oct 2026: "£7.50 for what,
-- exactly?" Migration 0147 gave a Pint Drop a closed measure of pint, half or
-- other, so a wine or a spirit price could only say its size as free text
-- under `other`. lib/drinkMeasure.ts now names six more measures: 125 ml,
-- 175 ml and 250 ml glasses, a bottle, a single and a double. This widens the
-- CHECK that mirrors the closed set and changes nothing else.
--
-- NOTHING IS SCALED, AND NOTHING BUT A PINT REACHES THE PINT LANE. A 175 ml
-- glass keeps its own figure and its own measure. The pint lane reads
-- `measure = 'pint'` alone (lib/drinkMeasure.ts `measureIsPint`, and the
-- partial index 0147 built on that predicate), so every new measure is held
-- out of pin colour, the cheapest-pint buckets and the Pint Index exactly as a
-- half is.
--
-- NO BACKFILL. No existing row is moved into a new measure. An `other` row
-- whose free label happens to say "175ml" stays `other`: the label is what a
-- drinker typed, and re-reading it as a measure is the guesswork 0147 refused.
--
-- The old constraint is dropped and the wider one added in the same
-- transaction, so no write can land between the two.

alter table public.pint_drops
  drop constraint if exists pint_drops_measure_known;

alter table public.pint_drops
  add constraint pint_drops_measure_known
  check (measure in ('pint', 'half', '125ml', '175ml', '250ml', 'bottle', 'single', 'double', 'other'));

comment on column public.pint_drops.measure is
  'The serving the price is about: pint, half, 125ml, 175ml, 250ml, bottle, single, double or other. Owned by lib/drinkMeasure.ts. Never scaled between measures.';
