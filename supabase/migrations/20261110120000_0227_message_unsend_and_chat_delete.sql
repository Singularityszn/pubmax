-- 0227: Unsend a message for everybody, and delete a chat for one person.
-- Captain applies; agents ship SQL only.
--
-- Reverse: supabase/migrations/rollback/20261110120000_0227_message_unsend_and_chat_delete_rollback.sql
--
-- UNSEND. `messages.unsent_at` marks a message its sender took back. The row
-- stays, so the thread can print one line where it was. Its words, its
-- attachment columns and its poll answers are cleared in the same request,
-- unless the message was reported: then the content stays for the moderator
-- queue (0224), and every reader sees only the line. `messages_content_chk`
-- (0102) is restated so an unsent message may hold no words and no attachment,
-- and `messages_unsent_empty_chk` says an unsent message keeps nothing unless
-- a report needs it.
--
-- DELETE CHAT. `conversation_deletions` holds one mark per person per
-- conversation: what that person deleted, up to when. Their inbox leaves the
-- conversation out until a message newer than the mark arrives, and their
-- thread reads only the messages after it. Nobody else's view moves. Browser
-- roles hold no privilege on it; the server route writes it with the service
-- role after its own member check.
--
-- The deploy may run ahead of this apply. Before it, the app reads threads
-- without `unsent_at`, refuses an unsend and a chat delete with a retryable
-- 503, and treats every chat as never deleted.

begin;

alter table public.messages
  add column if not exists unsent_at timestamptz;

comment on column public.messages.unsent_at is
  'When the sender unsent it. Readers see one line instead of the message. Content is kept only while the message is reported.';

alter table public.messages drop constraint if exists messages_content_chk;
alter table public.messages
  add constraint messages_content_chk
  check (char_length(body) >= 1 or attachment_kind is not null or unsent_at is not null);

alter table public.messages drop constraint if exists messages_unsent_empty_chk;
alter table public.messages
  add constraint messages_unsent_empty_chk
  check (
    unsent_at is null
    or flagged_at is not null
    or (char_length(body) = 0 and attachment_kind is null)
  );

create table if not exists public.conversation_deletions (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  handle          text not null,
  deleted_at      timestamptz not null default now(),
  primary key (conversation_id, handle)
);

comment on table public.conversation_deletions is
  'One person''s delete of one conversation. Their inbox and thread show only messages after deleted_at. Nobody else''s view changes.';

-- The handle alphabet (migration 0029), as conversation_members keeps it.
alter table public.conversation_deletions drop constraint if exists conversation_deletions_handle_chk;
alter table public.conversation_deletions
  add constraint conversation_deletions_handle_chk
  check (handle ~ '^[a-z0-9_]{1,30}$');

alter table public.conversation_deletions enable row level security;
revoke all on table public.conversation_deletions from public, anon, authenticated;
grant select, insert, update, delete on table public.conversation_deletions to service_role;

commit;
