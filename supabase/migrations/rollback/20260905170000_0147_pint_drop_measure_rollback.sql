-- Rollback of 0147. This DROPS THE COLUMNS AND EVERY MEASURE IN THEM.
--
-- Worth saying plainly, because the loss is not symmetrical with the gain. No
-- price, date, author or confirmation is touched: every Pint Drop survives
-- exactly as it was written. What is lost is the answer to "what serving was
-- this?", and with it the only thing holding a half out of the pint lane.
--
-- So rolling this back RESTORES THE DEFECT battle test D04 found: the rows the
-- backfill flagged go back to reading as pints, and a "Half of lager" at £2.60
-- can once again paint a pin, lead a cheapest-pint bucket and be cited by the
-- Pint Index at a pub whose pint is £5.50. The flags are not recoverable from
-- the app afterwards either, because the drink text they were derived from is
-- free text and re-deriving it is the guesswork this migration replaced.
--
-- Withdraw any Pint Index edition published between the apply and the rollback
-- before running this: an edition built while the flags were live cites a set
-- of pubs this rollback would let the live Index disagree with.

drop index if exists public.pint_drops_pint_measure_venue_idx;

alter table public.pint_drops
  drop constraint if exists pint_drops_measure_label_only_on_other,
  drop constraint if exists pint_drops_measure_known;

alter table public.pint_drops
  drop column if exists measure_label,
  drop column if exists measure;
