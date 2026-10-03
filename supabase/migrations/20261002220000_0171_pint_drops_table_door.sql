-- Close the Pint Drop table and realtime door (Fable full-repo review B-2).
--
-- Apply AFTER 0170. Captain applies; agents ship SQL only.
--
-- WHAT WAS WRONG. `0066` granted `authenticated` SELECT on the Pint Drop table.
-- `0118` renamed that table to `public.pint_drops` and the grant went with it.
-- The row policy still admits `visibility in ('public','anonymous')`, so any
-- signed-in account could read an anonymous author's real handle, plus
-- moderator_note, report_reason, report_count, receipt_photo_key and a retired
-- handle beside author_retired_at. `0067` granted the same whole-table SELECT
-- on `public.structured_visit_reports`. `0066`'s column grant on
-- `community_prices` included `contributor_handle`. `0014` put the Pint Drop
-- table in the `supabase_realtime` publication, so a `postgres_changes`
-- subscription delivered that raw row. The public DTO withholds the handle.
-- The table grant and the publication did not.
--
-- WHAT THIS DOES.
--   • Revoke SELECT on `pint_drops` and `structured_visit_reports` from
--     `authenticated`. The service role keeps its grant; the route is the read.
--   • Revoke SELECT on the `visit_reports` compatibility view as well. It is
--     security_invoker over `pint_drops`, and a grant on the view is the old
--     name of the same door.
--   • Drop `contributor_handle` from the `community_prices` column grant.
--     The other sheet columns stay.
--   • Take `pint_drops` out of `supabase_realtime`.
--   • Admit one private broadcast topic, `live:pint-drops`, to `authenticated`.
--     The server sends a payload-free signal (lib/pintDropsBroadcast.server.ts);
--     the browser subscribes private (lib/realtime.ts) and refetches. A browser
--     with no session is not admitted and keeps its poll. The policy is
--     permissive and names this topic only, so the messaging policies from
--     0148 are untouched.
--
-- The publication and `realtime.messages` are platform objects. The session
-- fixture stands in for them. If either is absent this RAISES: a door that
-- quietly stayed open is worse than a migration that refuses to apply.
--
-- Reverse: supabase/migrations/rollback/20261002220000_0171_pint_drops_table_door_rollback.sql

begin;

revoke select on table public.pint_drops from authenticated;
revoke select on table public.structured_visit_reports from authenticated;
revoke select on table public.visit_reports from authenticated;

revoke select (contributor_handle) on table public.community_prices from authenticated;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception
      'supabase_realtime publication is absent; 0171 cannot take pint_drops out of it'
      using hint = 'Apply on a Supabase project, or load scripts/rls/session-fixture.sql first.';
  end if;

  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'pint_drops'
  ) then
    alter publication supabase_realtime drop table public.pint_drops;
  end if;
end $$;

do $$
begin
  if to_regclass('realtime.messages') is null then
    raise exception
      'realtime.messages is absent; 0171 cannot install the pint drop channel policy'
      using hint = 'Apply on a Supabase project, or load scripts/rls/session-fixture.sql first.';
  end if;

  execute 'drop policy if exists pubmax_pint_drops_topic_read on realtime.messages';
  execute $policy$
    create policy pubmax_pint_drops_topic_read
      on realtime.messages
      for select
      to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and realtime.topic() = 'live:pint-drops'
      )
  $policy$;
end $$;

commit;
