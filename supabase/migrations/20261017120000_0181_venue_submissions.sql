-- Venue submissions, Phase 1 (0181): a signed-in drinker names a pub the map
-- does not have, and can attach its menu and the prices they saw.
-- Captain applies. Agents ship SQL and a rollback beside it.
-- Reverse: rollback/20261017120000_0181_venue_submissions_rollback.sql
--
-- WHAT A ROW IS. A PROPOSAL, never a venue. Nothing reads these tables to draw
-- a pin, answer a search or admit a write: a venue still exists only in the
-- committed packs, and an accepted submission reaches them through the offline
-- pack rebuild, the same door the parallel-discovery lane uses. Accepting one
-- here only stamps its status.
--
-- WHAT A PRICE IS. What the submitter says they saw, kept as a jsonb array the
-- route has already validated against the closed drink vocabulary and the
-- community price envelope. It carries no Price Standing: a reviewer checks
-- each figure before any of it enters the reviewed drink-price lane.
--
-- WHAT A LINK IS. Provenance only. `website` and `menu_url` are never fetched
-- by the app. A harvest may read one only after the owner records it as a
-- source, through `lib/harvest/sourcePolicy.ts` like every other URL.
--
-- WHAT A FILE IS. A menu photo (stripped of metadata and re-encoded as JPEG) or
-- a PDF, in the private bucket under `venue-submissions/<owner>/<submission>/`.
-- The CHECK holds the key inside its owner's folder, so a service-role signed
-- URL can never be pointed at another lane's object, and account deletion
-- removes the folder through the Storage API before the auth row goes.
--
-- LEAVES WITH THE ACCOUNT. Both tables are keyed to the auth user with ON
-- DELETE CASCADE, the 0174 shape, so deleting the account deletes every
-- submission and file row it wrote and the tombstone trigger needs no edit.
--
-- SERVICE ROLE ONLY. RLS is on and no browser role has a grant. Reads and
-- writes go through `/api/venue-submissions` (the owner's own rows, the owner
-- resolved from the session) and `/api/admin/venue-submissions` (moderators).

create table if not exists public.venue_submissions (
  id                    uuid primary key default gen_random_uuid(),
  owner_user_id         uuid not null references auth.users (id) on delete cascade,
  name                  text not null,
  address               text not null,
  postcode              text not null default '',
  latitude              double precision,
  longitude             double precision,
  website               text not null default '',
  menu_url              text not null default '',
  opening_hours         text not null default '',
  note                  text not null default '',
  prices                jsonb not null default '[]'::jsonb,
  status                text not null default 'pending',
  duplicate_of_venue_id text,
  reviewer_note         text,
  reviewed_at           timestamptz,
  created_at            timestamptz not null default now(),
  constraint venue_submissions_name_len_check
    check (length(name) between 1 and 120),
  constraint venue_submissions_address_len_check
    check (length(address) between 1 and 200),
  constraint venue_submissions_postcode_len_check
    check (length(postcode) <= 10),
  constraint venue_submissions_position_check
    check (
      (latitude is null and longitude is null)
      -- Both or neither: a half-null pair reads NULL, which a CHECK lets through.
      or (latitude is not null and longitude is not null
        and latitude between 49.8 and 60.95 and longitude between -8.7 and 1.8)
    ),
  constraint venue_submissions_website_check
    check (website = '' or (length(website) <= 500 and website ~ '^https://')),
  constraint venue_submissions_menu_url_check
    check (menu_url = '' or (length(menu_url) <= 500 and menu_url ~ '^https://')),
  constraint venue_submissions_opening_hours_len_check
    check (length(opening_hours) <= 300),
  constraint venue_submissions_note_len_check
    check (length(note) <= 500),
  constraint venue_submissions_prices_check
    check (jsonb_typeof(prices) = 'array' and jsonb_array_length(prices) <= 20),
  constraint venue_submissions_status_check
    check (status in ('pending', 'accepted', 'declined', 'duplicate')),
  constraint venue_submissions_duplicate_check
    check (
      (status = 'duplicate' and duplicate_of_venue_id is not null
        and length(duplicate_of_venue_id) between 1 and 64)
      or (status <> 'duplicate' and duplicate_of_venue_id is null)
    ),
  constraint venue_submissions_reviewer_note_len_check
    check (reviewer_note is null or length(reviewer_note) <= 500)
);

create index if not exists venue_submissions_owner_created_idx
  on public.venue_submissions (owner_user_id, created_at desc);

create index if not exists venue_submissions_status_created_idx
  on public.venue_submissions (status, created_at desc);

create table if not exists public.venue_submission_files (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references public.venue_submissions (id) on delete cascade,
  owner_user_id  uuid not null references auth.users (id) on delete cascade,
  object_key     text not null unique,
  kind           text not null,
  content_type   text not null,
  byte_size      integer not null,
  sha256         text not null,
  created_at     timestamptz not null default now(),
  constraint venue_submission_files_kind_check
    check (
      (kind = 'image' and content_type = 'image/jpeg' and object_key ~ '\.jpg$')
      or (kind = 'pdf' and content_type = 'application/pdf' and object_key ~ '\.pdf$')
    ),
  constraint venue_submission_files_key_check
    check (
      starts_with(
        object_key,
        'venue-submissions/' || owner_user_id::text || '/' || submission_id::text || '/'
      )
      and object_key !~ '\.\.'
    ),
  constraint venue_submission_files_size_check
    check (byte_size between 1 and 4194304),
  constraint venue_submission_files_sha256_check
    check (sha256 ~ '^[0-9a-f]{64}$')
);

create index if not exists venue_submission_files_submission_idx
  on public.venue_submission_files (submission_id, created_at);

alter table public.venue_submissions enable row level security;
alter table public.venue_submission_files enable row level security;

revoke all on table public.venue_submissions from public, anon, authenticated;
revoke all on table public.venue_submission_files from public, anon, authenticated;
grant select, insert, update, delete on table public.venue_submissions to service_role;
grant select, insert, update, delete on table public.venue_submission_files to service_role;

drop policy if exists venue_submissions_client_deny on public.venue_submissions;
create policy venue_submissions_client_deny
  on public.venue_submissions
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists venue_submission_files_client_deny on public.venue_submission_files;
create policy venue_submission_files_client_deny
  on public.venue_submission_files
  for all
  to anon, authenticated
  using (false)
  with check (false);
