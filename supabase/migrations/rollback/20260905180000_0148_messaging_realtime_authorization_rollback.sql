-- Rollback for 0148 (messaging realtime authorization).
--
-- READ THIS BEFORE RUNNING IT. Dropping this policy does not restore a working
-- lane: both halves of the messaging realtime code speak PRIVATE, so with no
-- policy every join is refused and every thread and inbox falls back to its
-- poll. That is the SAFE failure and it is the intended one - the alternative,
-- a public channel, is the F-1 activity oracle this migration closed. Roll the
-- code back with it, or accept polling until the policy is reinstated.

begin;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists pubmax_messaging_topics_read on realtime.messages';
  end if;
end $$;

drop function if exists pubmax_private.rls_may_read_messaging_topic(text);

commit;
