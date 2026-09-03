-- Rollback of 0140. This DROPS THE COLUMNS AND EVERY CONFIRMATION IN THEM.
--
-- That is the honest rollback, and it is worth saying plainly: a confirmation
-- is derived evidence the app minted, not a drinker's own words. Every Pint
-- Drop, its price, its date and its author survive untouched, and the
-- second-reporter pass re-mints a confirmation for any pair still inside the
-- 30 day window the next time somebody logs a price there. What is lost is the
-- minted id, so a published Pint Index edition citing one would be citing a row
-- that no longer answers. Withdraw such an edition before rolling back.

drop index if exists public.pint_drops_confirmed_venue_idx;

alter table public.pint_drops
  drop constraint if exists pint_drops_confirming_drop_only_on_pair,
  drop constraint if exists pint_drops_confirmation_basis_known,
  drop constraint if exists pint_drops_confirmation_complete;

alter table public.pint_drops
  drop column if exists confirming_drop_id,
  drop column if exists confirmation_basis,
  drop column if exists confirmed_at,
  drop column if exists confirmation_id;
