-- The bill check (0220): one row for each bill PUBMAXX read, and the
-- moderation queue of bills that do not show their price.
-- Captain applies. Agents ship SQL and a rollback beside it.
-- Reverse: rollback/20261105120000_0220_price_bill_checks_rollback.sql
--
-- Captain 5 Nov 2026: "when a priced Pint Drop or community price arrives with
-- a bill photo, read the bill and check it against the submitted price."
-- Until now a price earned `receipt` evidence (0218) because a photo was
-- attached, and nothing read it. The app now lands every price `unchecked`,
-- reads the bill after the answer (lib/billCheck.server.ts, the board
-- reader's zero-retention vision lane) and writes ONE row here:
--
--   match       a line on the bill shows the submitted price to the penny. The
--               app then moves the drop's `price_evidence` to `receipt`. This
--               table grants nothing by itself.
--   mismatch    the bill is readable and no line shows the price. The price
--               stays `unchecked` and the row waits for a moderator.
--   unreadable  no priced line could be read. The price stays `unchecked`.
--
-- WHAT A ROW HOLDS. The verdict, the price it checked (in pennies, as
-- community_prices holds it), the pub, and only the lines the verdict needs:
-- the matching line on a match, every priced line on a mismatch, none on an
-- unreadable bill. Each line is an item name and a price. No photo, no venue
-- name or date read off the bill, no card digits, no person's name: the app
-- strips every run of four or more digits from a line name before it gets
-- here, and the CHECKs below bound the shape.
--
-- WHAT IT NAMES. A Pint Drop, a community price, or both when the one-tap door
-- paired them. A bill is read once, so each price has at most one row.
--
-- NEVER DELETED BY THE CHECK OR THE QUEUE. A moderator REVIEWS a mismatch by
-- stamping `reviewed_at` and `review_decision` (`kept` or `hidden`); hiding
-- the price itself goes through that lane's own moderator door. A row leaves
-- only with the price it names (ON DELETE CASCADE), and no app path deletes a
-- priced drop or a community price.
--
-- SERVICE ROLE ONLY. RLS is on, no browser role has a grant, and no policy
-- names anon or authenticated. The background run and the moderation route
-- both use the service role, which bypasses RLS, so the advisor's
-- `rls_enabled_no_policy` is answered at the route door (supabase/AGENTS.md,
-- Astra F07).

begin;

create table if not exists public.price_bill_checks (
  id                  uuid primary key default gen_random_uuid(),
  pint_drop_id        uuid references public.pint_drops (id) on delete cascade,
  community_price_id  uuid references public.community_prices (id) on delete cascade,
  venue_id            text not null,
  price_pennies       integer not null,
  result              text not null,
  lines               jsonb not null default '[]'::jsonb,
  checked_at          timestamptz not null default now(),
  reviewed_at         timestamptz,
  review_decision     text,
  constraint price_bill_checks_subject_check
    check (pint_drop_id is not null or community_price_id is not null),
  constraint price_bill_checks_venue_id_check
    check (length(venue_id) between 1 and 120),
  constraint price_bill_checks_price_check
    check (price_pennies > 0),
  constraint price_bill_checks_result_check
    check (result in ('match', 'mismatch', 'unreadable')),
  constraint price_bill_checks_lines_shape_check
    check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 20),
  -- The lines the verdict needs, and no more: a match keeps the line that
  -- shows the price, an unreadable bill keeps nothing.
  constraint price_bill_checks_lines_verdict_check
    check (
      (result = 'unreadable') = (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) = 0)
    ),
  constraint price_bill_checks_review_decision_check
    check (review_decision is null or review_decision in ('kept', 'hidden')),
  -- A review is a stamp and a decision together, and only a mismatch waits
  -- for one.
  constraint price_bill_checks_review_stamp_check
    check ((reviewed_at is null) = (review_decision is null)),
  constraint price_bill_checks_review_mismatch_check
    check (reviewed_at is null or result = 'mismatch')
);

-- A bill is read once: one row for each price it names.
create unique index if not exists price_bill_checks_pint_drop_idx
  on public.price_bill_checks (pint_drop_id)
  where pint_drop_id is not null;

create unique index if not exists price_bill_checks_community_price_idx
  on public.price_bill_checks (community_price_id)
  where community_price_id is not null;

-- The moderation queue: unreviewed mismatches, newest first.
create index if not exists price_bill_checks_queue_idx
  on public.price_bill_checks (checked_at desc)
  where result = 'mismatch' and reviewed_at is null;

comment on table public.price_bill_checks is
  'One row for each bill PUBMAXX read against the price it came with (captain 5 Nov 2026): match, mismatch or unreadable, and only the item lines the verdict needs. Unreviewed mismatches are the moderation queue. Service role only. Owned by lib/billCheck.ts and lib/billCheckStore.ts.';

alter table public.price_bill_checks enable row level security;

revoke all on table public.price_bill_checks from public, anon, authenticated;
grant select, insert, update, delete on table public.price_bill_checks to service_role;

commit;
