-- A partial index for the inbox's unread count (messaging speed, 2026-09-05).
--
-- The inbox used to ask ONE query per conversation, each pulling up to 200
-- rows, to find the last message and count the viewer's unread rows. It now
-- asks TWO batched reads for the whole inbox (lib/messagesStore.ts,
-- listConversations). The unread read is
--
--   select conversation_id from public.messages
--    where conversation_id in (<the viewer's conversation ids>)
--      and sender_handle <> <viewer> and read_at is null
--
-- and EXPLAIN on PostgreSQL 16 (local Supabase stack, 49,010 message rows, 60
-- conversations for the viewer with 150 rows each, 15 unread each) shows it
-- already on an index, not a scan: a Bitmap Index Scan on
-- messages_conversation_created_idx over 9,000 index rows, then a heap filter
-- that removes 8,100 of them, in 1.02 ms. The cost is proportional to EVERY
-- row in the viewer's conversations, because the existing index cannot see
-- read_at. This partial index narrows it to the rows that are unread: the same
-- query reads 1,800 index rows and answers in 0.43 ms. The heap filter on
-- sender_handle stays, because an unread row from the viewer is impossible by
-- construction (read_at marks what the OTHER side read), so the half it
-- removes is the other participant's own unread sends and is bounded the same
-- way.
--
-- The write side is unchanged: the index is maintained only for rows whose
-- read_at is null, which is the small, short-lived set. The thread read and
-- markRead are untouched (both bitmap-scan messages_conversation_created_idx on
-- one conversation id already). This is a speed migration and nothing depends
-- on it: the code answers the same rows with or without it.
--
-- CONCURRENTLY, so a busy messages table is not locked while it builds; run it
-- outside a transaction block.

create index concurrently if not exists messages_unread_by_conversation_idx
  on public.messages (conversation_id)
  where read_at is null;
