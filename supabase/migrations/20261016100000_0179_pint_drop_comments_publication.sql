-- 0179 takes `public.pint_drop_comments` out of the `supabase_realtime`
-- publication (DB hygiene finding DB-5).
--
-- Apply AFTER 0178. Captain applies; agents ship SQL only.
--
-- WHAT WAS WRONG. `0014` added `pint_drop_comments` to the publication so
-- `lib/realtime.ts` could hear new replies. `0050` then made comment reads
-- API-only, and `subscribeToComments` has polled GET /api/pint-drops/comments
-- ever since: nothing subscribes to this table. `0171` took `pint_drops` out of
-- the publication and left this table behind. It is NOT a disclosure, because
-- `anon` and `authenticated` hold no privilege on the table, so Realtime has no
-- reader to deliver a change to. It does cost logical decoding on every
-- comment write for a stream nobody reads.
--
-- WHAT THIS DOES. Drops the table from the publication when it is a member.
-- No grant, policy or row moves. Re-running is a no-op.
--
-- The publication is a platform object; the session fixture stands in for it.
-- If it is absent this RAISES, matching 0171, rather than reporting success on
-- a cluster it never looked at.
--
-- Reverse: supabase/migrations/rollback/20261016100000_0179_pint_drop_comments_publication_rollback.sql

begin;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception
      'supabase_realtime publication is absent; 0179 cannot take pint_drop_comments out of it'
      using hint = 'Apply on a Supabase project, or load scripts/rls/session-fixture.sql first.';
  end if;

  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'pint_drop_comments'
  ) then
    alter publication supabase_realtime drop table public.pint_drop_comments;
  end if;
end $$;

commit;
