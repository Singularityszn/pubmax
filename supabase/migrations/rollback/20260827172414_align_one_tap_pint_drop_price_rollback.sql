-- Fail closed if the repair must be rolled back. Restoring the former function
-- would restore the split-price defect.
drop function if exists public.create_one_tap_price_pair(
  text, text, integer, text, text, timestamptz, uuid, text, text, text, text, text
);
