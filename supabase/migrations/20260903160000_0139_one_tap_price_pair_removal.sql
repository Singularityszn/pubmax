-- Withdraw public.create_one_tap_price_pair (#1292).
--
-- The function is live in production (applied 2026-08-27 from PR #1237, then
-- recorded by 0132) and NO app code calls it. It cannot report the drinker's
-- own figure. It builds the Pint Drop from whatever row the shared
-- public.upsert_attributed_community_price_if_newer RETURNS, and that upsert is
-- a newer-wins write: when the stored (actor, venue, drink) row is NEWER than
-- the request, it keeps the stored row and returns it. A 5 pound observation
-- sent against a stored 8 pound row therefore mints a drop reporting 8 pounds,
-- stores nothing the drinker typed, and tells nobody. A Pint Drop is a
-- first-party account of what one person paid, so that is not a drop.
--
-- The honest lane already ships. app/api/price-submit/route.ts writes the drop
-- from the REQUEST value (submission.priceGbp), reverts the Community Price
-- when the drop write fails, and refuses with PAIRING_REPAIR_REQUIRED when the
-- revert also fails. Nothing in the tree schedules a move off it.
--
-- Withdrawal rather than repair, because repairing this function means giving
-- the shared upsert a wrote-or-kept receipt, and that needs a return-type
-- change to the ONE security-definer function every community price write goes
-- through. Reworking the live write path to un-break a function nothing calls
-- buys risk, not safety. Should the pairing lane ever be revived for its
-- atomicity, the receipt belongs at that upsert boundary FIRST, so no caller
-- has to guess again; __tests__/oneTapPricePairRemovalEffective.test.ts holds
-- that door.
--
-- This DROPS THE FUNCTION AND NO ROW. A pair-written Pint Drop carries no
-- column separating it from one the live two-phase lane wrote, and EXECUTE is
-- service_role only, so any such row needed a manual service-role call. Deleting
-- a drinker's real Pint Drop on that guess would be a worse defect than the
-- latent one this closes. The verification query for the owner to run
-- read-only before applying is in the pull request body.
--
-- 0132 stays in the ledger: it records what production ran. This records the
-- withdrawal. The rollback file restores 0132's exact body and grants.

drop function if exists public.create_one_tap_price_pair(
  text, text, integer, text, text, timestamptz, uuid, text, text, text, text, text
);
