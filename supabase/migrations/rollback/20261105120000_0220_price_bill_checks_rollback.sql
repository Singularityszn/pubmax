-- Rollback 0220: drop the bill check table. THIS DELETES EVERY BILL CHECK ON
-- FILE, including every mismatch still waiting in the moderation queue.
--
-- No price, date, author, authority key or confirmation is touched, and no
-- price is hidden or shown by this: every Pint Drop and community price
-- survives as it is. A drop the bill check moved to `receipt` keeps that word,
-- because it lives on `pint_drops.price_evidence` (0218), not here.
--
-- THE COST. The queue forgets which bills did not show their price. Those
-- prices stay `unchecked` on the map, as they already are, so nothing reaches
-- a pin that was not there before; what is lost is the moderator's list. Read
-- the unreviewed mismatches out first if they are still to be judged:
--
--   select * from public.price_bill_checks
--   where result = 'mismatch' and reviewed_at is null;
--
-- While the app is deployed with the bill check, a check after this rollback
-- cannot be recorded: outside production it falls back to process memory, and
-- in production the write refuses and is logged. No match grants
-- `receipt` without its stored check.

begin;

drop index if exists public.price_bill_checks_queue_idx;
drop index if exists public.price_bill_checks_community_price_idx;
drop index if exists public.price_bill_checks_pint_drop_idx;

drop table if exists public.price_bill_checks;

commit;
