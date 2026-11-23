-- Rollback 0261: drops `conversation_members.last_read_at`. Every member's
-- group read mark is lost. No message is lost and nothing is disclosed.
-- Group messages read after 0261 carry no `read_at`, so after this rollback
-- they count as unread for every member until somebody opens the thread, and
-- then the first reader clears them for everybody again (audit F15).

begin;

alter table public.conversation_members
  drop column if exists last_read_at;

commit;
