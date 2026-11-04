-- Rollback for 0200. Drops the trigger and its function, so a bare insert can
-- again mint a profiles row under a renamed account's retired alias. The
-- application keeps its own refusal (lib/profileOwnership.ts gateHandleAction
-- and profileStore.ensure()), so the cost is the database half only. Rows a
-- rollback window lets in are not removed when 0200 is applied again.

begin;

drop trigger if exists profiles_handle_not_held_by_alias on public.profiles;
drop function if exists pubmax_private.refuse_profile_handle_held_by_alias();

commit;
