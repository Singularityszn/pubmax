-- Group seat read marks (0261). Captain applies; agents ship SQL only.
--
-- WHAT WAS WRONG. A message row has ONE `read_at`. That is right for a DM,
-- where only one other person can read it. In a group, the first member who
-- opened the thread stamped `read_at` on every message, so every other
-- member's inbox counted those messages as read, and the sender saw "Seen"
-- although only one person had read them.
--
-- WHAT THIS DOES. Each group seat gets its own mark: `last_read_at` is the
-- `created_at` of the newest message that member has read. A message counts as
-- read for a member when that member's mark reaches it. A group read moves only
-- the reader's own seat and no longer stamps the message rows.
--
-- NULLABLE, NO DEFAULT, NO BACKFILL. Null means the member has no mark yet, so
-- the old `read_at` stamps still answer for them, exactly as before the apply.
-- A `read_at` already on a group row stays read for everybody, so no old
-- message turns unread. Only reads after the apply are per member.
--
-- A deploy can run ahead of this apply: the store reads a missing column as
-- "no marks" and stamps the message rows the old way.
--
-- NO GRANT OR POLICY MOVES. Browser roles keep SELECT behind
-- `conversation_members_participant_select` (0155). Every write is the
-- service role. A handle rename (0256) and an account deletion (0180) update
-- the seat row, so the mark moves with it.
--
-- Reverse: supabase/migrations/rollback/20261122150000_0261_group_seat_read_marks_rollback.sql

begin;

alter table public.conversation_members
  add column if not exists last_read_at timestamptz;

comment on column public.conversation_members.last_read_at is
  'The created_at of the newest message this member has read. Null means no mark yet, and the message row''s read_at answers instead. Group only: a direct conversation keeps read_at on its messages.';

commit;
