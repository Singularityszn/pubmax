-- Rollback of 0218. This DROPS THE COLUMN AND EVERY WORD IN IT, and that is
-- NOT NEUTRAL: run the application rollback first, or accept the cost below.
--
-- No price, date, author, authority key or confirmation is touched: every Pint
-- Drop survives as it was written. What is lost is which prices came with a
-- bill and which were typed without one.
--
-- THE COST. Once the column is gone every UNCHECKED row reads as billed, as
-- every pre-0218 row does, so each lone typed price in its window would wear
-- the pin's provisional mark it was never given (captain decision 9 reversed
-- for the rows already on file). Nothing reaches a band, a cheapest claim or
-- the Pint Index that way, because those still need a second drinker or a
-- minted confirmation. If that mark is not acceptable, hide the unchecked rows
-- through the moderator door before running this, or keep the column.
--
-- While the app is deployed with the decision 9 store, a typed price after this
-- rollback is REFUSED with the bill line (the store's additive-rollout guard,
-- `isMissingPriceEvidenceColumnError`), so the rollback loses new typed prices
-- rather than mislabelling them.

alter table public.pint_drops
  drop constraint if exists pint_drops_price_evidence_needs_price;

alter table public.pint_drops
  drop constraint if exists pint_drops_price_evidence_known;

alter table public.pint_drops
  drop column if exists price_evidence;
