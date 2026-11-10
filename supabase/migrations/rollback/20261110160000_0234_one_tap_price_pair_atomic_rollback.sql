-- Removes atomic pairing. Existing observations and Pint Drops remain stored.
drop function if exists public.create_one_tap_price_pair_atomic(
  text, text, integer, text, text, timestamptz, jsonb
);
