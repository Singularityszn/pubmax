-- Regular night reports (0206): a drinker adds a weekly night at a pub (a quiz,
-- a music night, the sport, comedy, karaoke or something else) with a photo of
-- the board or the poster that says so.
-- Captain applies. Agents ship SQL and a rollback beside it.
-- Reverse: rollback/20261030210000_0206_regular_night_reports_rollback.sql
--
-- WHAT A ROW IS. A DATED DRINKER REPORT, never a venue fact and never tonight's
-- listing. The read prints it apart from the sourced regular nights, as "per a
-- drinker, seen <date>", with the reporter's handle until a person confirms it.
-- Nothing reads this table to change a pack, a pin, hours or a price.
--
-- A PHOTO IS REQUIRED. `photo_key` is the Storage key of the board or poster,
-- written by the route under `regular-night-boards/<reporter>/` before the row,
-- and the CHECK holds that shape. Only a moderator opens it, through a signed
-- URL. Account deletion walks that folder (`lib/accountOwnedObjects.ts`).
--
-- IT EXPIRES. `expires_at` is 90 days after the report. A different signed-in
-- account may say "still on" ONCE per report (`regular_night_report_still_on`,
-- one row per report and account), which moves `expires_at` 90 days on and
-- stamps `last_seen_at`. An expired row is never read.
--
-- THE VENUE IS AN ID, NOT A FOREIGN KEY. Venues live in the committed packs.
-- The route resolves the id through `lib/venueWriteTarget.server.ts` first.
--
-- LEAVES WITH THE ACCOUNT. Both tables key to the auth user with ON DELETE
-- CASCADE, the 0203 shape, so the tombstone trigger needs no edit.
--
-- SERVICE ROLE ONLY. RLS is on, no browser role has a grant, and no policy
-- names anon or authenticated. Writes go through `/api/regular-nights` and
-- verdicts through `/api/admin/regular-nights` (supabase/AGENTS.md, Astra F07).

create table if not exists public.regular_night_reports (
  id                uuid primary key default gen_random_uuid(),
  venue_id          text not null,
  kind              text not null,
  weekday           smallint not null,
  start_time        text,
  note              text not null default '',
  photo_key         text not null,
  reporter_user_id  uuid not null references auth.users (id) on delete cascade,
  created_at        timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '90 days'),
  status            text not null default 'open',
  confirmed_by      text,
  confirmed_at      timestamptz,
  constraint regular_night_reports_venue_id_check
    check (length(venue_id) between 1 and 128),
  constraint regular_night_reports_kind_check
    check (kind in ('quiz', 'music', 'sport', 'comedy', 'karaoke', 'other')),
  constraint regular_night_reports_weekday_check
    check (weekday between 0 and 6),
  constraint regular_night_reports_start_time_check
    check (start_time is null or start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint regular_night_reports_note_len_check
    check (length(note) <= 120),
  constraint regular_night_reports_photo_key_check
    check (photo_key ~ '^regular-night-boards/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'),
  constraint regular_night_reports_status_check
    check (status in ('open', 'confirmed', 'hidden')),
  constraint regular_night_reports_confirmed_check
    check (
      (confirmed_at is null and confirmed_by is null)
      or (confirmed_at is not null and confirmed_by is not null
        and length(confirmed_by) between 1 and 64)
    ),
  constraint regular_night_reports_expiry_check
    check (expires_at > created_at)
);

-- The public read: one weekday's live rows, and one pub's live rows.
create index if not exists regular_night_reports_weekday_live_idx
  on public.regular_night_reports (weekday, expires_at desc)
  where status in ('open', 'confirmed');
create index if not exists regular_night_reports_venue_live_idx
  on public.regular_night_reports (venue_id, expires_at desc)
  where status in ('open', 'confirmed');

-- The moderator queue: rows in a status, newest first.
create index if not exists regular_night_reports_status_created_idx
  on public.regular_night_reports (status, created_at desc);

-- The reporter's own rows (account export) and the account-deletion cascade.
create index if not exists regular_night_reports_reporter_created_idx
  on public.regular_night_reports (reporter_user_id, created_at desc);

-- "Still on": one per report and account. The primary key IS the once.
create table if not exists public.regular_night_report_still_on (
  report_id   uuid not null references public.regular_night_reports (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (report_id, user_id)
);

-- The account-deletion cascade reads by account.
create index if not exists regular_night_report_still_on_user_idx
  on public.regular_night_report_still_on (user_id);

alter table public.regular_night_reports enable row level security;
alter table public.regular_night_report_still_on enable row level security;

revoke all on table public.regular_night_reports from public, anon, authenticated;
revoke all on table public.regular_night_report_still_on from public, anon, authenticated;
grant select, insert, update, delete on table public.regular_night_reports to service_role;
grant select, insert, update, delete on table public.regular_night_report_still_on to service_role;
