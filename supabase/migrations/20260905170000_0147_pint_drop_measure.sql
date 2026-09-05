-- Give a Pint Drop a MEASURE, so a half never reads as a pint (battle test D04).
--
-- What was found, on the preview of 5 Sept 2026: a drop of
-- `drink: "Half of lager", priceGbp: 2.6` was accepted into the pint lane, the
-- venue sheet head read "£2.60 Logged once", the second drinker's door read
-- "Confirm £2.60 a pint at Arnos Arms", a second reporter agreed and the pass
-- minted a confirmation over the pair. A confirmed £2.60 then fed pin colour,
-- the cheapest-pint buckets and the Pint Index for a pub whose pint is £5.50.
-- The drink text was the only place a half could be said, and no read path ever
-- asked it.
--
-- The measure is DATA, and it is not derivable. `drink` is free text a drinker
-- types, and inferring the serving from it after the fact is guesswork that
-- gets a pub's price wrong in both directions. lib/drinkMeasure.ts is the ONE
-- owner of the closed set and of the words; this column is where it lands.
--
-- NOTHING IS EVER SCALED. A half of lager is not half the price of a pint of
-- it: pubs price the two apart, and doubling a figure would publish a price
-- nobody paid under the word of the drinker who paid the other one. A non-pint
-- row keeps its own figure, stays visible and dated on the pub's own sheet with
-- its measure printed beside it, and is held OUT of every pint lane.

alter table public.pint_drops
  add column if not exists measure text not null default 'pint',
  add column if not exists measure_label text;

comment on column public.pint_drops.measure is
  'The serving the price is about: pint, half or other. Owned by lib/drinkMeasure.ts. Never scaled between measures.';
comment on column public.pint_drops.measure_label is
  'Free label for an `other` measure (schooner, third, bottle). Null on pint and half, which name themselves.';

do $$
begin
  -- The closed set, mirrored from DRINK_MEASURES in lib/drinkMeasure.ts.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.pint_drops'::regclass
       and conname = 'pint_drops_measure_known'
  ) then
    alter table public.pint_drops
      add constraint pint_drops_measure_known
      check (measure in ('pint', 'half', 'other'));
  end if;

  -- A label beside `pint` or `half` would be a second name for a measure that
  -- already names itself, and a reader would then have two answers to one
  -- question. Only `other` may carry one.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.pint_drops'::regclass
       and conname = 'pint_drops_measure_label_only_on_other'
  ) then
    alter table public.pint_drops
      add constraint pint_drops_measure_label_only_on_other
      check (measure_label is null or measure = 'other');
  end if;
end
$$;

-- ── BACKFILL: FLAG, NEVER SCALE ─────────────────────────────────────────────
--
-- Every existing row defaults to 'pint', which is exactly what the lane already
-- assumed of it, so the default alone changes nothing. This pass then takes
-- back out the rows that SAY, in their own drink text, that they are not pints.
--
-- It only ever writes the `measure` column. No price is touched, no row is
-- deleted, no confirmation is withdrawn: a flagged row keeps its figure, its
-- date, its author and its confirmation id, and simply stops answering the
-- pint lane's question. lib/venues.ts holds it out at read time and
-- lib/pintIndexFromConfirmations.ts counts it under `measure_not_pint`, so the
-- Arnos Arms £2.60 leaves the map and the Index without anything being erased.
--
-- The word list MIRRORS NON_PINT_MEASURE_PATTERNS in lib/drinkMeasure.ts, which
-- is the owner. __tests__/drinkMeasure.test.ts holds the two together so this
-- copy cannot drift.
--
-- Word-bounded on purpose: the half word catches "Half of lager" and leaves
-- "Halfway House Pale" alone. The fraction forms carry no word characters at
-- their edges, so they are bounded on whitespace or a string edge instead.
--
-- THIS PASS IS DELIBERATELY BROADER THAN THE RUNTIME PREDICATE, and the
-- asymmetry is written down here because it is the one place the two rules
-- differ. `measureNamedInDrinkText` also asks whether a spelled measure word is
-- used AS a measure, so "Other Half Green Diamond" logs as the pint it is
-- (review finding F-22). This pass judges rows written before anybody could be
-- asked, so it errs the other way: a brewery name caught here loses a pint from
-- the pint lane, which publishes no wrong price, while a half missed here is
-- the £2.60 that fed pin colour and the Pint Index.

update public.pint_drops
   set measure = 'half'
 where measure = 'pint'
   and drink is not null
   and (
     drink ~* '\mhalf\M'
     or drink ~* '\mhalves\M'
     or drink ~* '(^|\s)1/2(\s|$)'
     or drink ~* '(^|\s)½(\s|$)'
   );

update public.pint_drops
   set measure = 'other'
 where measure = 'pint'
   and drink is not null
   and (
     drink ~* '\msmall\M'
     or drink ~* '\mschooner\M'
     or drink ~* '\mthird\M'
     or drink ~* '\mthirds\M'
     or drink ~* '(^|\s)1/3(\s|$)'
     or drink ~* '(^|\s)⅓(\s|$)'
     or drink ~* '(^|\s)2/3(\s|$)'
     or drink ~* '(^|\s)⅔(\s|$)'
   );

-- The read this adds: one venue's pint rows, which is what every price lane in
-- lib/venues.ts asks for. Partial on the measure so the index stays small and
-- serves the only question anybody asks of this column.
create index if not exists pint_drops_pint_measure_venue_idx
  on public.pint_drops (venue_id, created_at desc)
  where measure = 'pint';
