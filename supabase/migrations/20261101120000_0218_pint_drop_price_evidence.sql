-- A TYPED PRICE WITHOUT A BILL IS UNCHECKED, and this column is where it says so.
--
-- Captain decision 9, 1 Nov 2026 (docs/plans/LAUNCH_PLAN_2026-11-01.md): "A
-- typed price without a receipt saves as 'logged by @handle, not checked'. It
-- shows on the venue. It does not colour the pin until a receipt or a second
-- person confirms it." ADR 0010 carries the dated amendment.
--
-- Until today the Pint Drop door refused a price with no photo of the bill
-- (0153, captain 7 Sept 2026), so every priced row on file was billed. The door
-- now takes the typed price, and the row has to SAY which kind it is, because
-- the trust lanes in lib/venues.ts hold an unchecked price away from the pin's
-- mark, its band, every cheapest claim and the Pint Index until a second,
-- independent drinker agrees with it.
--
-- `receipt_photo_key` cannot carry that fact alone. A Storage outage saves a
-- billed drop without its key (the 0153 rule: our outage may not cost the
-- drinker), and every row written before 0153 has no key either, so "no key"
-- would quietly demote rows that earned their standing.
--
-- THE CLOSED SET MIRRORS lib/pintDropReceipt.ts `PRICE_EVIDENCE`:
--
--   receipt    the write came with a photo of the bill.
--   unchecked  a typed price with no bill.
--
-- NULL is every row written before this file and every drop with no price.
-- They read exactly as they always have. NO BACKFILL: nothing on file is
-- re-judged, and no row is rewritten.
--
-- The store EARNS the word from what arrived with the write (`priceEvidenceFor`
-- in lib/pintDropsStore.ts's create path) and never takes it from a client.
-- Until this file is applied the store's additive-rollout guard
-- (`isMissingPriceEvidenceColumnError`) saves a billed price without the
-- column and REFUSES an unchecked one, so a deploy that runs ahead of the apply
-- answers a typed price exactly as the door did before decision 9: add the
-- bill. Saving it without its word would read it as billed and mark the pin.
--
-- NO GRANT AND NO POLICY MOVES. 0171 revoked the browser roles' SELECT on this
-- table, so the column is read through the service role and the public DTO
-- (lib/pintDropsStore.ts `toDTO`) alone, like every other column on the row.

alter table public.pint_drops
  add column if not exists price_evidence text;

alter table public.pint_drops
  drop constraint if exists pint_drops_price_evidence_known;

alter table public.pint_drops
  add constraint pint_drops_price_evidence_known
  check (price_evidence is null or price_evidence in ('receipt', 'unchecked'));

-- Evidence is about a FIGURE. A note, a memory or a photo of the pub carries
-- no price, so it carries no evidence either.
alter table public.pint_drops
  drop constraint if exists pint_drops_price_evidence_needs_price;

alter table public.pint_drops
  add constraint pint_drops_price_evidence_needs_price
  check (price_evidence is null or price_gbp is not null);

comment on column public.pint_drops.price_evidence is
  'What stands behind a priced drop''s figure: receipt (a photo of the bill came with it) or unchecked (a typed price with no bill, captain decision 9, 1 Nov 2026). Null on every row written before 0218 and on every drop with no price. Owned by lib/pintDropReceipt.ts.';
