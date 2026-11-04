-- Rollback of 0210. Narrows the measure CHECK back to pint, half and other.
--
-- What it costs. A row logged under one of the six new measures cannot stay
-- under it once the CHECK narrows, so it moves to `other` and carries the
-- measure's own printed word as its free label ("175 ml", "Bottle"). No price,
-- date, author or confirmation is touched, the row still prints its size, and
-- it is still held out of every pint lane, because `other` is not `pint`. What
-- is lost is the closed word: the app reads those rows as free labels from then
-- on, so a later reader that groups by measure (a wine index) would not find
-- them. Nothing is scaled in either direction.
--
-- Order. Revert the app (or hide the six new measure chips) BEFORE this runs,
-- because an app that still offers a new size sends a measure this narrowed
-- CHECK refuses. As a backstop, the price store retries such a refusal once as
-- `other` with the size's own word as its label (lib/pintDropsStore.ts).

update public.pint_drops
   set measure_label = case measure
         when '125ml' then '125 ml'
         when '175ml' then '175 ml'
         when '250ml' then '250 ml'
         when 'bottle' then 'Bottle'
         when 'single' then 'Single'
         when 'double' then 'Double'
       end,
       measure = 'other'
 where measure in ('125ml', '175ml', '250ml', 'bottle', 'single', 'double');

alter table public.pint_drops
  drop constraint if exists pint_drops_measure_known;

alter table public.pint_drops
  add constraint pint_drops_measure_known
  check (measure in ('pint', 'half', 'other'));

comment on column public.pint_drops.measure is
  'The serving the price is about: pint, half or other. Owned by lib/drinkMeasure.ts. Never scaled between measures.';
