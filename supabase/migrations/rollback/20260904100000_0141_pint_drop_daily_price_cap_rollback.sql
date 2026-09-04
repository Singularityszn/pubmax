-- Rollback of 0141. Drops the daily-cap guard and the day stamp behind it.
--
-- This costs no Pint Drop: price_day is derived from created_at and price_gbp,
-- both of which stay, and re-applying 0141 re-derives the same stamp from the
-- same rows. What comes back is the finding: the cap returns to a
-- check-then-insert that a concurrent burst can walk through. Roll back only to
-- unblock, and re-apply.

drop index if exists public.pint_drops_priced_day_unique_idx;

alter table public.pint_drops
  drop column if exists price_day;
