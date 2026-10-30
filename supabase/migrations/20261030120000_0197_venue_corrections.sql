-- Venue corrections (0197): the "That's wrong" door on the venue sheet. A
-- signed-in drinker says a pub has shut, its hours are wrong, or something else
-- listed on its sheet is off.
-- Captain applies. Agents ship SQL and a rollback beside it.
-- Reverse: rollback/20261030120000_0197_venue_corrections_rollback.sql
--
-- WHAT A ROW IS. A NOTE TO A PERSON, never an edit. Nothing reads this table to
-- move a pin, hide a pub, change hours or touch a price. A moderator reads the
-- queue at /admin and fixes the fact through the offline pack rebuild. Resolving
-- or dismissing a row only stamps its status.
--
-- A PRICE IS NOT A CORRECTION. The door offers "Price has changed", but that
-- choice opens the existing price log, so the kind CHECK names three kinds and
-- `price` is not one of them.
--
-- THE VENUE IS AN ID, NOT A FOREIGN KEY. Venues live in the committed packs,
-- not in a table. The route resolves the id through the same door every
-- community write uses (`lib/venueWriteTarget.server.ts`) before it stores one.
--
-- WHO RESOLVED IT. `resolved_by` is the named moderator role when the
-- deployment binds one, else the literal `admin`: the admin gate is one shared
-- token today, and the column says so rather than inventing a person.
--
-- LEAVES WITH THE ACCOUNT. Keyed to the auth user with ON DELETE CASCADE, the
-- 0174 and 0189 shape, so deleting the account deletes every correction it
-- wrote and the tombstone trigger needs no edit.
--
-- SERVICE ROLE ONLY. RLS is on, no browser role has a grant, and no policy
-- names anon or authenticated. Writes go through `/api/venue-corrections` (the
-- owner resolved from the session) and reads and verdicts through
-- `/api/admin/venue-corrections` (moderators). The service role bypasses RLS,
-- so the advisor's `rls_enabled_no_policy` is answered at the route door
-- (supabase/AGENTS.md, Astra F07).

create table if not exists public.venue_corrections (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users (id) on delete cascade,
  venue_id       text not null,
  kind           text not null,
  note           text not null default '',
  status         text not null default 'open',
  resolved_at    timestamptz,
  resolved_by    text,
  created_at     timestamptz not null default now(),
  constraint venue_corrections_venue_id_check
    check (length(venue_id) between 1 and 128),
  constraint venue_corrections_kind_check
    check (kind in ('closed', 'hours', 'other')),
  constraint venue_corrections_note_len_check
    check (length(note) <= 200),
  constraint venue_corrections_status_check
    check (status in ('open', 'resolved', 'dismissed')),
  constraint venue_corrections_resolution_check
    check (
      (status = 'open' and resolved_at is null and resolved_by is null)
      or (status <> 'open' and resolved_at is not null
        and resolved_by is not null and length(resolved_by) between 1 and 64)
    )
);

-- The moderator queue: open rows, newest first.
create index if not exists venue_corrections_status_created_idx
  on public.venue_corrections (status, created_at desc);

-- The owner's own rows (account export) and the account-deletion cascade.
create index if not exists venue_corrections_owner_created_idx
  on public.venue_corrections (owner_user_id, created_at desc);

alter table public.venue_corrections enable row level security;

revoke all on table public.venue_corrections from public, anon, authenticated;
grant select, insert, update, delete on table public.venue_corrections to service_role;
