-- Rollback for 0201 ("With" on a diary entry).
--
-- COST: every With tag on a diary entry is deleted, approved or not, and so
-- is every free-text name typed on a diary entry. The entries, their ratings,
-- reviews and usuals stay, and every Pint Drop tag stays. It discloses
-- nothing: a diary tag was readable only by the entry's owner and, as a
-- proposal, by the person tagged. The app reads the missing column as "no
-- diary tags", so it keeps working. Safe to re-run.

begin;

delete from public.pint_drop_with_tags where drop_id is null;

alter table public.pint_drop_with_tags
  drop constraint if exists pint_drop_with_tags_diary_entry_target_key;

alter table public.pint_drop_with_tags
  drop constraint if exists pint_drop_with_tags_one_subject_check;

alter table public.pint_drop_with_tags
  drop column if exists diary_entry_id;

alter table public.pint_drop_with_tags
  alter column drop_id set not null;

alter table public.diary_entries
  drop constraint if exists diary_entries_with_names_len_check;

alter table public.diary_entries
  drop column if exists with_names;

commit;
