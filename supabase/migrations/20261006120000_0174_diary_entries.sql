-- The Diary, Phase 1 (0174): a drinker's own dated log of pub visits.
-- Captain applies. Agents ship SQL and a rollback beside it.
--
-- WHAT IT IS. One row is an OPINION about one visit: which pub, which London
-- calendar day, an optional half-star rating (1 to 5 in half steps) and an
-- optional review of at most 280 characters. It is not a Visit Report
-- (structured room facts, no stars) and it is not a community vote
-- (`venue_ratings`). Phase 1 rows are PRIVATE: the only visibility is
-- 'private', the CHECK says so, and nothing reads a row for anyone but its
-- owner. Friends and public arrive with their own policies and a migration.
--
-- ONE ENTRY PER VENUE PER DAY. UNIQUE (owner_profile_id, venue_id,
-- visited_on) makes a diary read as nights and never as taps, and it is the
-- race-proof half of the duplicate refusal the API also checks.
--
-- OWNER-ONLY, AT THE ROW AND AT THE GRANT. The owner is a profile id, with
-- ON DELETE CASCADE, so a diary leaves with the account that wrote it and no
-- retired handle ever carries one. RLS is on. The browser roles may SELECT
-- their own rows through `pubmax_private.rls_owns_profile` and nothing else:
-- 0170, 0171 and 0172 took browser writes off every table the app writes
-- through the service role, and this table starts there. INSERT, UPDATE and
-- DELETE belong to the service role behind `/api/diary`, which resolves the
-- owner from the session and never from the request body. Anonymous gets a
-- deny policy and no grant.
--
-- NOTHING HERE COUNTS CONSUMPTION. A row records a visit and an opinion,
-- never how much anybody drank.

create table if not exists public.diary_entries (
  id               uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles (id) on delete cascade,
  venue_id         text not null,
  venue_name       text not null,
  -- The London calendar day of the visit, not a timestamp.
  visited_on       date not null,
  -- numeric(2,1) holds 1.0 to 5.0; the CHECK keeps half steps only.
  rating           numeric(2,1),
  review           text not null default '',
  visibility       text not null default 'private',
  created_at       timestamptz not null default now(),
  constraint diary_entries_rating_check
    check (rating is null or (rating >= 1 and rating <= 5 and (rating * 2) = trunc(rating * 2))),
  constraint diary_entries_review_len_check
    check (length(review) <= 280),
  constraint diary_entries_venue_id_len_check
    check (length(venue_id) between 1 and 64),
  constraint diary_entries_venue_name_len_check
    check (length(venue_name) between 1 and 120),
  constraint diary_entries_visited_on_check
    check (visited_on >= date '2000-01-01'),
  constraint diary_entries_visibility_check
    check (visibility in ('private')),
  constraint diary_entries_one_per_venue_day
    unique (owner_profile_id, venue_id, visited_on)
);

create index if not exists diary_entries_owner_visited_idx
  on public.diary_entries (owner_profile_id, visited_on desc, created_at desc);

alter table public.diary_entries enable row level security;

revoke all on table public.diary_entries from public, anon, authenticated;
grant select on table public.diary_entries to authenticated;
grant select, insert, update, delete on table public.diary_entries to service_role;

drop policy if exists diary_entries_owner_select on public.diary_entries;
create policy diary_entries_owner_select
  on public.diary_entries
  for select
  to authenticated
  using (pubmax_private.rls_owns_profile(owner_profile_id));

drop policy if exists diary_entries_anon_deny on public.diary_entries;
create policy diary_entries_anon_deny
  on public.diary_entries
  for all
  to anon
  using (false)
  with check (false);
