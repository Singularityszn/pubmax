-- Reverses 0257. This DISCLOSES DATA: every thread participant can read
-- `messages.flagged_by` again, which names who reported a message. No rows change.

begin;

revoke select on table public.messages from authenticated;
grant select on table public.messages to authenticated;

commit;
