-- "With" on a diary entry (0201). Apply AFTER 0198 and 0199.
-- Captain applies; agents ship SQL only.
--
-- Reverse: supabase/migrations/rollback/20261030160000_0201_diary_with_tags_rollback.sql
--
-- WHAT IT IS. The diary log form takes the same "With" field as a Pint Drop:
-- free-text names for people who are not on PUBMAXX, and consented handle tags
-- for people who are. A tag goes to the same tag inbox with the same block
-- refusal, so it is the same row and the same consent machine, not a second
-- table: `pint_drop_with_tags` gains a nullable `diary_entry_id`, and a row
-- names EXACTLY ONE of a drop and a diary entry.
--
-- WHAT THIS DOES.
--   1. `pint_drop_with_tags.drop_id` becomes nullable, and a CHECK says one of
--      `drop_id` and `diary_entry_id` is set and never both.
--   2. `diary_entry_id` references `diary_entries(id)` ON DELETE CASCADE, so a
--      removed entry, or a deleted account's diary, takes its tags with it.
--   3. A UNIQUE (diary_entry_id, target_profile_id) keeps a pair to one row,
--      as (drop_id, target_profile_id) already does for a drop. Each key has
--      a NULL in the other lane's rows, and NULLs are distinct, so the two
--      keys never collide.
--   4. `diary_entries.with_names`: the free-text names, NOT NULL DEFAULT '',
--      at most 120 characters, as PRIVATE as the review beside it.
--
-- NO GRANT AND NO POLICY MOVES. The tag table stays service-mediated with RLS
-- on and nothing granted to a browser role (0198), and the new diary column
-- inherits 0174's owner-only SELECT.
--
-- A DEPLOY AHEAD OF THE APPLY keeps every Pint Drop tag working (the store
-- reads without the column on a 42703), refuses nothing on a diary log, and
-- simply writes no diary tag or names until this is applied.

begin;

alter table public.pint_drop_with_tags
  alter column drop_id drop not null;

alter table public.pint_drop_with_tags
  add column if not exists diary_entry_id uuid
    references public.diary_entries(id) on delete cascade;

alter table public.pint_drop_with_tags
  drop constraint if exists pint_drop_with_tags_one_subject_check;

alter table public.pint_drop_with_tags
  add constraint pint_drop_with_tags_one_subject_check
  check (num_nonnulls(drop_id, diary_entry_id) = 1);

alter table public.pint_drop_with_tags
  drop constraint if exists pint_drop_with_tags_diary_entry_target_key;

alter table public.pint_drop_with_tags
  add constraint pint_drop_with_tags_diary_entry_target_key
  unique (diary_entry_id, target_profile_id);

comment on column public.pint_drop_with_tags.diary_entry_id is
  'The diary entry this With tag sits on, when it is not on a Pint Drop. Exactly one of drop_id and diary_entry_id is set.';

alter table public.diary_entries
  add column if not exists with_names text not null default '';

alter table public.diary_entries
  drop constraint if exists diary_entries_with_names_len_check;

alter table public.diary_entries
  add constraint diary_entries_with_names_len_check
  check (length(with_names) <= 120);

comment on column public.diary_entries.with_names is
  'With: free-text names of people not on PUBMAXX, at most 120 characters, private like the review. Handles never land here.';

commit;
