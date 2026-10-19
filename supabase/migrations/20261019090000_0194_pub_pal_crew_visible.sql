-- A Pub Pal its owner shows to their crew (0194). Apply AFTER 0193.
-- Captain applies; agents ship SQL only.
--
-- Reverse: supabase/migrations/rollback/20261019090000_0194_pub_pal_crew_visible_rollback.sql
--
-- WHAT IT IS. "Pals walk together": on a crew plan's map, a member's Pal walks
-- the route beside the reader's own, but ONLY when that member chose to show it
-- to their crew. The choice is this one column, off by default, set by the
-- owner from /pal through PATCH /api/pub-pal.
--
-- WHO READS IT. Nobody new at the table. `pub_pals_owner_all` (0067) still
-- admits an authenticated caller to their OWN row and nobody else's, and
-- `pub_pals_anon_deny` still denies anon, so no browser can read another
-- person's Pal here. The only reader of another member's Pal is the server
-- route GET /api/plans/[id]/pals, on the service role, and it answers only a
-- caller holding that plan's member capability, only with members of that
-- plan who set this column, and never with an account id
-- (docs/security/PERMISSION_MATRIX.md, "Crew Pals").
--
-- WHAT THIS DOES. Adds `pub_pals.crew_visible`, NOT NULL, DEFAULT false, so
-- every existing Pal stays exactly as private as it is today. A constant
-- default rewrites no table on PostgreSQL 11 or later.

begin;

alter table public.pub_pals
  add column if not exists crew_visible boolean not null default false;

comment on column public.pub_pals.crew_visible is
  'The owner shows this Pal to the members of their crew plans (Pals walk together). Off by default; only GET /api/plans/[id]/pals reads it for another member.';

commit;
