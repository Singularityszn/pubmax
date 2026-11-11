-- Rollback 0237: a stored message stops stamping its conversation.
-- It drops the trigger and its function. send's best-effort update still moves
-- last_message_at. Stamps that 0237 moved forward stay where they are, which
-- discloses nothing.
begin;

drop trigger if exists messages_stamp_conversation on public.messages;
drop function if exists public._stamp_conversation_last_message_at();

commit;
