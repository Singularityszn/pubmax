-- "Your usual here" on a diary entry (0199). Apply AFTER 0196.
-- Captain applies; agents ship SQL only.
--
-- Reverse: supabase/migrations/rollback/20261030140000_0199_diary_usual_drink_rollback.sql
--
-- WHAT IT IS. One optional line on a diary entry: the drink the owner orders
-- at that pub, as they typed it, at most 40 characters. It is as PRIVATE as
-- the review beside it: no grant and no policy moves here, so the column
-- inherits 0174's owner-only SELECT and the service role stays the only
-- writer, behind `/api/diary`.
--
-- WHAT THIS DOES. Adds `diary_entries.usual_drink`, NOT NULL, DEFAULT '', so
-- every existing entry reads as "no usual" and a constant default rewrites no
-- table on PostgreSQL 11 or later. The CHECK mirrors MAX_DIARY_USUAL_DRINK in
-- lib/diary.ts and counts characters, as the review's CHECK does.
--
-- A DEPLOY AHEAD OF THE APPLY keeps the visit and drops the usual
-- (`isMissingUsualDrinkColumn` in lib/diaryStore.ts), the 0153 rule.

begin;

alter table public.diary_entries
  add column if not exists usual_drink text not null default '';

alter table public.diary_entries
  drop constraint if exists diary_entries_usual_drink_len_check;

alter table public.diary_entries
  add constraint diary_entries_usual_drink_len_check
  check (length(usual_drink) <= 40);

comment on column public.diary_entries.usual_drink is
  'Your usual here: the drink the owner orders at this pub, free text, at most 40 characters, private like the review.';

commit;
