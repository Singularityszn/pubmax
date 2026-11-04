-- Kitchen reports (0209): a drinker at the pub taps "Still serving" or
-- "Kitchen closed" on the food row (launch review idea A1).
-- Captain applies. Agents ship SQL and a rollback beside it.
-- Reverse: rollback/20261031000000_0209_kitchen_reports_rollback.sql
--
-- WHAT A ROW IS. A DATED DRINKER REPORT, never a venue fact and never hours.
-- The read prints "Kitchen open, said @handle 20 min ago" from the newest row
-- inside 90 minutes, the crowd reading's window, and nothing after it. Nothing
-- reads this table to change a pack, a pin, opening hours or a kitchen time.
-- The handle is read live from the profile, never stored here.
--
-- ONE CONFIRMER, NO THIRD. `confirmed_by` and `confirmed_at` are stamped once,
-- by a different account (the CHECK refuses the reporter), and the route's
-- update only moves a row whose `confirmed_at` is still null.
--
-- THE VENUE IS AN ID, NOT A FOREIGN KEY. Venues live in the committed packs.
-- The route resolves the id through `lib/venueWriteTarget.server.ts` first.
--
-- LEAVES WITH THE ACCOUNT. `reporter_user_id` keys to the auth user with ON
-- DELETE CASCADE, so a departing account's reports go with it and the
-- tombstone trigger needs no edit. `confirmed_by` is ON DELETE SET NULL: a
-- departing confirmer's id comes off and the confirmation time stays, so a
-- report that was confirmed once stays confirmed and is never confirmed twice.
--
-- SERVICE ROLE ONLY. RLS is on, no browser role has a grant, and no policy
-- names anon or authenticated. Writes go through `/api/kitchen-reports`
-- (supabase/AGENTS.md, Astra F07).

create table if not exists public.kitchen_reports (
  id                uuid primary key default gen_random_uuid(),
  venue_id          text not null,
  state             text not null,
  reporter_user_id  uuid not null references auth.users (id) on delete cascade,
  reported_at       timestamptz not null default now(),
  confirmed_by      uuid references auth.users (id) on delete set null,
  confirmed_at      timestamptz,
  constraint kitchen_reports_venue_id_check
    check (length(venue_id) between 1 and 128),
  constraint kitchen_reports_state_check
    check (state in ('open', 'closed')),
  constraint kitchen_reports_confirmer_check
    check (confirmed_by is null or (confirmed_at is not null and confirmed_by <> reporter_user_id)),
  constraint kitchen_reports_confirmed_after_check
    check (confirmed_at is null or confirmed_at >= reported_at)
);

-- The public read: one pub's newest row.
create index if not exists kitchen_reports_venue_reported_idx
  on public.kitchen_reports (venue_id, reported_at desc);

-- The reporter's own rows (account export) and the account-deletion cascade.
create index if not exists kitchen_reports_reporter_reported_idx
  on public.kitchen_reports (reporter_user_id, reported_at desc);

-- The SET NULL on a departing confirmer reads by account.
create index if not exists kitchen_reports_confirmed_by_idx
  on public.kitchen_reports (confirmed_by)
  where confirmed_by is not null;

alter table public.kitchen_reports enable row level security;

revoke all on table public.kitchen_reports from public, anon, authenticated;
grant select, insert, update, delete on table public.kitchen_reports to service_role;
