-- A NEW PRICE COMES WITH THE BILL, and this column is where the bill lands.
--
-- Captain 7 Sept 2026: "whenever a person is submitting a new price, they have
-- to take a picture of the bill. Let's keep that as the right way to go about
-- it."
--
-- A Pint Drop already carries two photo slots, and neither is this one.
-- `pint_photo_key` is the drinker's pint, which is a picture of what they were
-- drinking. `venue_photo_key` is the pub. A RECEIPT is a third thing: it is
-- evidence about the FIGURE, and it is the only one of the three the product
-- refuses a price without.
--
-- It is a Storage key, exactly like its two siblings, so the same signed-URL
-- lane serves it and the same delete lane removes it. Nothing about the row's
-- own RLS changes: a receipt is visible on a visible drop and withheld on a
-- hidden one, because it is part of the drop rather than a record of its own.
--
-- ADDITIVE AND NULLABLE. Every drop written before today has no receipt, and
-- no read may treat that as a fault: the requirement is on a NEW price at the
-- write door, never a retro-judgement of a row already on file. The app's
-- additive-rollout guard (`isMissingReceiptColumnError`, lib/pintDropsStore.ts)
-- saves the drop without its key until this migration is applied, so a deploy
-- that runs ahead of the captain's apply loses a photo rather than a price.

alter table public.pint_drops
  add column if not exists receipt_photo_key text;

comment on column public.pint_drops.receipt_photo_key is
  'Storage key for the photo of the bill or receipt behind this price. Required at the write door for a new price (lib/pintDropReceipt.ts); null on every row written before 0153 and on every drop that carries no price.';
