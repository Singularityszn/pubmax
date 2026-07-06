-- Threaded replies on a Pint Drop comment (issue #37, PRD § "The For-You map" —
-- "X-style threaded replies so a story continues after the night"). ONE level of
-- nesting only: a comment may reply to a top-level comment, but a reply may not
-- itself be replied to. Apply AFTER 0006 (which created pint_drop_comments) and
-- alongside 0012.
--
-- Model: add a nullable self-referencing `parent_id` to pint_drop_comments.
--   • parent_id NULL      → a top-level comment (today's rows; the default, so
--                           every existing comment stays top-level, unchanged).
--   • parent_id = <id>    → a reply to that top-level comment.
-- The "one level only" rule (a reply's parent must itself be top-level, and the
-- parent must belong to the SAME drop) is enforced in the APP layer
-- (lib/commentsStore.ts addComment) — see the trust note below. `on delete
-- cascade` means deleting/removing a top-level comment removes its replies too.
--
-- Style mirrors 0001_visit_reports.sql / 0006_social_layer.sql / 0012 exactly:
--   • `add column if not exists` — idempotent, re-runnable, upgrades in place.
--   • `create index if not exists`.
--   • No new RLS policy needed: replies live in the SAME table, so the existing
--     pint_drop_comments_public_read (status = 'visible') already gates them.
--
-- Trust boundary: the one-level constraint is enforced in application code, not
-- a DB CHECK. Postgres can't express "parent_id must reference a row whose own
-- parent_id is NULL" as a simple CHECK (it needs a subquery / trigger). The
-- server is the single writer (service role) and validates on every insert
-- (parent exists + same drop + parent is itself top-level), the same app-layer
-- posture the rest of the social layer documents. Add a trigger later if a
-- second writer is ever introduced.

-- ── parent_id ────────────────────────────────────────────────────────────────
-- A reply points at the top-level comment it hangs under. Nullable so existing
-- rows and any insert that omits it stay top-level. Self-referencing FK with
-- ON DELETE CASCADE: removing a parent removes its whole reply subtree.
alter table public.pint_drop_comments
  add column if not exists parent_id uuid
  references public.pint_drop_comments (id) on delete cascade;

-- Fetch a comment's replies (and order them) without a table scan. Threads are
-- read as "top-level for this drop, then replies grouped by parent".
create index if not exists pint_drop_comments_parent_created_idx
  on public.pint_drop_comments (parent_id, created_at asc);

-- ─────────────────────────────────────────────────────────────────────────────
-- REALTIME PUBLICATION — the integrator/user must run these (no MCP this
-- session, so this migration ships the SQL but does NOT apply it).
-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase Realtime only emits `postgres_changes` for tables that belong to the
-- `supabase_realtime` publication. lib/realtime.ts subscribes to INSERTs on
-- `pint_drop_comments` (live replies) and `visit_reports` (live drop pins/feed);
-- until these tables are added to the publication, no realtime events fire and
-- the client silently uses its polling fallback. Run once, in the SQL editor /
-- via CLI, wrapped so re-running is safe:
--
--   do $$
--   begin
--     if not exists (
--       select 1 from pg_publication_tables
--       where pubname = 'supabase_realtime'
--         and schemaname = 'public' and tablename = 'pint_drop_comments'
--     ) then
--       alter publication supabase_realtime add table public.pint_drop_comments;
--     end if;
--     if not exists (
--       select 1 from pg_publication_tables
--       where pubname = 'supabase_realtime'
--         and schemaname = 'public' and tablename = 'visit_reports'
--     ) then
--       alter publication supabase_realtime add table public.visit_reports;
--     end if;
--   end $$;
--
-- Privacy note: adding these tables to the publication does NOT widen what a
-- reader sees. The raw INSERT row is never rendered — lib/realtime.ts treats
-- events as bare signals and refetches through the visibility-filtered read
-- paths (#29). RLS still governs any direct client read.
