-- Captain applies rollback. Rows, owners, revisions and deadlines are retained.
-- Cost: an UPDATE that waited past expiry can write again after this guard is removed.
begin;

drop trigger pub_pal_tool_turns_refuse_expired_update on public.pub_pal_tool_turns;
drop function pubmax_private.refuse_expired_pub_pal_tool_turn_update();

commit;
