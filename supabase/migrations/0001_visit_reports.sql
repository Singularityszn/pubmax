-- Pint Drops persistence. Mirrors the PintDrop shape in lib/pintDrops.ts
-- (snake_case). Writes go through the service role only (server route);
-- the public read is limited to visible rows.
--
-- Storage bucket (create once, out of band — buckets are not SQL objects):
--   In the Supabase dashboard (Storage) or via the Management API, create a
--   bucket named `pint-drops` with PUBLIC READ enabled. Uploads are done by the
--   service role from the server (uploadPintPhoto), so no anon write policy is
--   needed. Object keys are stored in visit_reports.pint_photo_key.

create extension if not exists "pgcrypto";

create table if not exists public.visit_reports (
  id               uuid primary key default gen_random_uuid(),
  venue_id         text not null,
  handle           text not null,
  drink            text,
  price_gbp        numeric,          -- null for note-only anecdotes
  passed_down_note text,
  era              text,
  pint_photo_key   text,             -- Storage object key in the pint-drops bucket
  provenance       text,            -- 'contributor' (priced) | 'anecdote' (note-only)
  status           text not null default 'visible', -- 'visible' | 'hidden' | 'pending'
  created_at       timestamptz not null default now()
);

create index if not exists visit_reports_venue_created_idx
  on public.visit_reports (venue_id, created_at desc);

alter table public.visit_reports enable row level security;

-- Public can read visible drops only. Hidden/pending stay server-side.
drop policy if exists visit_reports_public_read on public.visit_reports;
create policy visit_reports_public_read
  on public.visit_reports
  for select
  using (status = 'visible');

-- No anon INSERT policy: with RLS on and no permissive policy, anon/authenticated
-- inserts are denied. The service role bypasses RLS, so only the server route writes.
