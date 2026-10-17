-- Rollback for 0179 (pint_drop_comments out of the realtime publication).
--
-- Puts `public.pint_drop_comments` back in `supabase_realtime`. That costs
-- logical decoding on every comment write again and discloses nothing: browser
-- roles still hold no privilege on the table, so Realtime has no reader to
-- deliver a change to. Safe to re-run.

begin;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and to_regclass('public.pint_drop_comments') is not null
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'pint_drop_comments'
     ) then
    alter publication supabase_realtime add table public.pint_drop_comments;
  end if;
end $$;

commit;
