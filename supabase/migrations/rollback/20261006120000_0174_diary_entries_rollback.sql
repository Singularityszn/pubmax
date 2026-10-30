-- Rollback 0174: drop the Diary Phase 1 table. THIS DELETES EVERY DIARY ENTRY
-- ANYBODY HAS LOGGED. Export first if any rows matter.

begin;

drop policy if exists diary_entries_anon_deny on public.diary_entries;
drop policy if exists diary_entries_owner_select on public.diary_entries;

drop index if exists public.diary_entries_owner_visited_idx;

-- 0201 keys diary With tags to this table. Dropping the table takes that
-- link with it: a diary tag row loses its subject, so the 0201 rollback is
-- the honest companion to this one. The constraint goes first so the drop
-- below is not refused.
alter table if exists public.pint_drop_with_tags
  drop constraint if exists pint_drop_with_tags_diary_entry_id_fkey;

drop table if exists public.diary_entries;

commit;
