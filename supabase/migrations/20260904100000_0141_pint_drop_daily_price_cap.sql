-- Make the "one price per pub per day" Pint Drop cap ATOMIC (pentest F-1).
--
-- The rule is stated in the product and enforced in the app: one PRICED drop
-- per venue + identity + London day. The enforcement was a SELECT
-- (pintDropsStore().hasPricedDropToday) followed a few lines later by an
-- INSERT, with no uniqueness underneath and a deliberate fail-open on the
-- lookup. Eight concurrent priced POSTs from one account to one pub therefore
-- all passed the check before any row landed: six were created and two were
-- refused. The impact is bounded, because every one of those rows carries ONE
-- authority key and corroboration needs TWO distinct ones, so nothing here
-- fabricates a corroborated or Confirmed price. But the cap is a rule we state,
-- and a rule enforced only by a check-then-insert is not enforced.
--
-- The fix is the shape the plan-seat path already uses (0129/0135): a partial
-- unique index plus a conflict-aware insert. The check stays as a soft
-- pre-check so the ordinary refusal keeps its wording and costs no failed
-- insert; this index is the hard guard behind it.
--
-- WHY A COLUMN AND NOT AN EXPRESSION. 0040 wrote down why the day bucket cannot
-- be an index expression: it needs timezone('Europe/London', created_at)::date,
-- and timezone(text, timestamptz) is only STABLE, so Postgres refuses it in an
-- index. A UTC day would index cleanly and would be the WRONG bucket: under BST
-- a London day runs 23:00 to 23:00 UTC, so a UTC-day index both admits a second
-- drop inside one London day and refuses a legitimate one on the next. So the
-- writer stamps the day it already computes, with the same londonDayKey() the
-- streak maths and hasPricedDropToday() share, and the index is on a plain
-- column: no drift between the two enforcers, and nothing marked IMMUTABLE that
-- is not.

alter table public.pint_drops
  add column if not exists price_day date;

comment on column public.pint_drops.price_day is
  'London calendar day a drop CLAIMS under the daily price cap, stamped on write by londonDayKey(). Null when the write claims none: a note-only memory, a community-price pairing, or a row written before 0141 the backfill below could not claim.';

-- WHICH WRITES THE CAP GOVERNS. The cap is stated by POST /api/pint-drops and
-- is that route's rule, not an invariant of this table: POST /api/price-submit
-- pairs a Pint Drop with every community price a drinker sends, and takes
-- several from one account at one pub in one day on purpose, with its own rate
-- limiter as the only brake. A guard over every row would refuse the second of
-- those. So the WRITER says whether it is under the cap, only those writes
-- claim a day, and the index below is on rows that claim one. Whether the
-- pairing lane should share the cap is a separate product question.

-- BACKFILL, DUPLICATE-SAFE. The rows this finding is about are already in the
-- table, so a naive backfill would make the unique index below fail to build
-- and take the whole migration with it. Stamp the EARLIEST priced, visible row
-- in each (venue, handle, London day) bucket and leave its same-day siblings
-- null. The kept row is the observation the cap always meant to keep (the first
-- one), so from today a capped write into an already-claimed bucket conflicts,
-- while the historical duplicates stay exactly where they are: this migration
-- deletes nobody's Pint Drop. Rows left null simply sit outside the index, and
-- the soft pre-check still covers them.
--
-- It claims a bucket whichever lane wrote the row it kept, and that is the same
-- reading the pre-check already has: hasPricedDropToday() counts every priced,
-- visible drop at that pub by that handle today, pairing rows included.
with claimed as (
  select
    id,
    (created_at at time zone 'Europe/London')::date as london_day,
    row_number() over (
      partition by venue_id, handle, (created_at at time zone 'Europe/London')::date
      order by created_at asc, id asc
    ) as seat
  from public.pint_drops
  where price_gbp is not null
    and status <> 'hidden'
    and price_day is null
)
update public.pint_drops as d
   set price_day = claimed.london_day
  from claimed
 where d.id = claimed.id
   and claimed.seat = 1;

-- The hard guard. The predicate is the app rule word for word: a PRICED drop
-- (a note-only memory is not a price observation) that is not hidden (a hidden
-- row has left every price surface, and hasPricedDropToday ignores it too, so a
-- drinker may log again after a moderator takes one down).
--
-- One consequence worth stating: restoring a hidden drop into a bucket a live
-- drop now holds is refused rather than silently doubling that bucket. That is
-- the same rule read in the other direction, and it fails loudly instead of
-- quietly.
create unique index if not exists pint_drops_priced_day_unique_idx
  on public.pint_drops (venue_id, handle, price_day)
  where price_gbp is not null
    and status <> 'hidden'
    and price_day is not null;
