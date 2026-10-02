-- Rollback for 0171 (Pint Drop table and realtime door).
--
-- READ THIS BEFORE RUNNING IT. This puts the grants back. Every signed-in
-- account can SELECT `pint_drops` and `structured_visit_reports` again, which
-- republishes an anonymous author's handle, moderator notes, report reasons,
-- receipt keys and `community_prices.contributor_handle`. It also puts
-- `pint_drops` back in the `supabase_realtime` publication, so a
-- `postgres_changes` subscriber receives that raw row again. That disclosure
-- is the cost. Roll the application back with it, or accept it.
--
-- Dropping the broadcast policy does not restore a public channel. The app
-- speaks PRIVATE on `live:pint-drops`, so with no policy every join is refused
-- and the map and feed fall back to their poll. That is the safe failure.

begin;

grant select on table public.pint_drops to authenticated;
grant select on table public.structured_visit_reports to authenticated;
grant select on table public.visit_reports to authenticated;
grant select (contributor_handle) on table public.community_prices to authenticated;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists pubmax_pint_drops_topic_read on realtime.messages';
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and to_regclass('public.pint_drops') is not null
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'pint_drops'
     ) then
    alter publication supabase_realtime add table public.pint_drops;
  end if;
end $$;

commit;
