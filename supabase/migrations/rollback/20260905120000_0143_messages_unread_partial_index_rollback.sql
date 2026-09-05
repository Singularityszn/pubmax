-- Rollback of 0143. Drops the partial unread index.
--
-- Costs nothing but the unread count's speed: the inbox read falls back to the
-- plain messages_conversation_created_idx bitmap scan it used before, which
-- EXPLAIN showed at 1.02 ms against 0.43 ms with the index on the same rows.
-- No row and no answer changes.

drop index concurrently if exists public.messages_unread_by_conversation_idx;
