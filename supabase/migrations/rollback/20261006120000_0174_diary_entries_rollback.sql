-- Rollback 0174: drop the Diary Phase 1 table. THIS DELETES EVERY DIARY ENTRY
-- ANYBODY HAS LOGGED. Export first if any rows matter.

begin;

drop policy if exists diary_entries_anon_deny on public.diary_entries;
drop policy if exists diary_entries_owner_select on public.diary_entries;

drop index if exists public.diary_entries_owner_visited_idx;

drop table if exists public.diary_entries;

commit;
