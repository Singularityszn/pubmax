-- Rollback for 0197 ("your usual here" on a diary entry).
--
-- Drops `diary_entries.usual_drink` and its CHECK. COST: every usual anybody
-- typed is deleted; the visits, ratings and reviews stay. It discloses
-- nothing, because the column was never readable by anybody but its owner.
-- The app reads a missing column as "no usual", so it keeps working, but a
-- new usual is lost on save until 0197 is applied again. Safe to re-run.

begin;

alter table public.diary_entries
  drop constraint if exists diary_entries_usual_drink_len_check;

alter table public.diary_entries
  drop column if exists usual_drink;

commit;
