-- Rollback of 0153. This DROPS THE COLUMN AND EVERY RECEIPT KEY IN IT.
--
-- No price, date, author or confirmation is touched: every Pint Drop survives
-- as it was written. What is lost is the link between a price and the bill
-- behind it, and the objects themselves are then unreferenced in Storage: run
-- the Storage sweep before this if those bytes must go too, because after it
-- nothing in the database names them.
--
-- The write door keeps asking for a bill while the app is deployed
-- (lib/pintDropReceipt.ts is the rule and it reads no column), and the store's
-- additive-rollout guard saves the drop without its key, so a rollback loses
-- new receipts rather than new prices.

alter table public.pint_drops
  drop column if exists receipt_photo_key;
