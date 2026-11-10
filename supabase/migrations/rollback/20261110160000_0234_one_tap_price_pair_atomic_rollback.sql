-- Removes atomic pairing. Existing observations and Pint Drops remain stored.
-- Before applying this rollback, deploy an application that no longer calls
-- create_one_tap_price_pair_atomic. Otherwise every paired pint price submission fails.

begin;

drop function if exists public.create_one_tap_price_pair_atomic(
  text, text, integer, text, text, timestamptz, jsonb
);

commit;
