-- 0256: a handle rename carries the account's inbox with it (audit F11).
--
-- THE FAULT. `rename_pubmaxx_handle` (0177) wrote only `profiles` and
-- `profile_handle_aliases`. Every messaging row names its person by handle
-- text, and `lib/messagesStore.ts` and `lib/notificationsStore.ts` read them by
-- the current handle. So a rename emptied the account's inbox. Its old thread
-- addresses answered 404, and a mate's reply under the old pair reached nobody.
--
-- THE FIX. The rename rewrites the handle-keyed messaging rows in the same
-- transaction, after the profile row lock that account deletion also takes
-- before these rows:
--   1. `conversations.handle_a` and `handle_b`, re-sorted so that
--      `conversations_pair_order_chk` (handle_a < handle_b) still holds.
--   2. `conversation_members.handle`, `conversation_deletions.handle`,
--      `message_poll_votes.voter_handle`.
--   3. `messages.sender_handle`, found by `sender_profile_id` (0151's index).
--   4. `notifications.recipient_handle`.
-- Only rows under the handle being retired move. Rows left under an older
-- alias by a rename before 0256 stay where they are. Moving them could merge a
-- split history, and that repair is a separate decision.
--
-- THE COLLISION. A pair, a seat, a deletion and a vote each have a unique key
-- on the handle. The new handle is in no profile and no alias, but a messaging
-- row from before the open route checked its recipient can still name it. The
-- rename refuses such a handle as `taken`, before any write. Rewriting onto it
-- would merge two people's histories, or hand the renamer somebody else's chat.
-- The `unique_violation` handler stays as the second line.
--
-- Every other line of the body is the 0177 body. Captain applies; agents ship
-- SQL only.
--
-- Rollback: rollback/20261122090000_0256_handle_rename_messaging_rollback.sql
-- Proof: __tests__/handleRenameMessagingMigrationEffective.test.ts

begin;

comment on column public.messages.sender_profile_id is
  'The profile that sent this message, stamped from profile_handle_aliases on insert. Account deletion uses this stable identity (0151). rename_pubmaxx_handle (0256) uses this column to find messages and rewrites sender_handle from the previous handle to the current handle.';

comment on column public.messages.sender_handle is
  'The sender''s handle. rename_pubmaxx_handle (0256) moves it from the previous handle to the current handle for messages matched by sender_profile_id.';

create or replace function public.rename_pubmaxx_handle(p_user_id uuid, p_handle text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handle text := lower(trim(p_handle));
  v_profile public.profiles%rowtype;
  v_previous text;
  v_retry_at timestamptz;
begin
  if p_user_id is null or v_handle !~ '^[a-z0-9_]{3,30}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'error', 'Choose a valid PUBMAXX handle.');
  end if;
  if v_handle in ('admin','api','help','moderation','official','pubmaxx','pubmaxxer','pubmaxxing','root','safety','staff','support','system','you')
     or v_handle ~ '^pubmaxx(ing|er)?_?(admin|help|official|safety|staff|support)$' then
    return jsonb_build_object('ok', false, 'code', 'reserved', 'error', 'That handle is reserved.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_handle, 0));
  select * into v_profile from public.profiles where user_id = p_user_id limit 1 for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'error', 'Claim a PUBMAXX handle first.');
  end if;
  v_previous := lower(v_profile.handle);
  if v_previous = v_handle then
    return jsonb_build_object('ok', true, 'profile_id', v_profile.id, 'previous_handle', v_previous, 'handle', v_handle);
  end if;
  v_retry_at := v_profile.handle_changed_at + interval '30 days';
  if v_profile.handle_changed_at is not null and now() < v_retry_at then
    return jsonb_build_object('ok', false, 'code', 'cooldown', 'error', 'You can rename your handle once every 30 days.', 'retry_at', v_retry_at);
  end if;
  if exists (select 1 from public.profile_handle_aliases where lower(handle) = v_handle)
     or exists (select 1 from public.profiles where lower(handle) = v_handle)
     or exists (select 1 from public.conversations where handle_a = v_handle or handle_b = v_handle)
     or exists (select 1 from public.conversation_members where handle = v_handle)
     or exists (select 1 from public.conversation_deletions where handle = v_handle)
     or exists (select 1 from public.message_poll_votes where lower(voter_handle) = v_handle) then
    return jsonb_build_object('ok', false, 'code', 'taken', 'error', 'That handle is already taken.');
  end if;
  update public.profile_handle_aliases set is_current = false, retired_at = now()
    where profile_id = v_profile.id and is_current;
  insert into public.profile_handle_aliases(profile_id, handle, is_current)
    values (v_profile.id, v_handle, true);
  update public.profiles set handle = v_handle, handle_changed_at = now(), updated_at = now()
    where id = v_profile.id;

  -- SET reads the old pair, so both columns see the same before-image.
  update public.conversations
     set handle_a = least(case when handle_a = v_previous then v_handle else handle_a end,
                          case when handle_b = v_previous then v_handle else handle_b end),
         handle_b = greatest(case when handle_a = v_previous then v_handle else handle_a end,
                             case when handle_b = v_previous then v_handle else handle_b end)
   where handle_a = v_previous or handle_b = v_previous;
  update public.conversation_members set handle = v_handle where handle = v_previous;
  update public.conversation_deletions set handle = v_handle where handle = v_previous;
  update public.message_poll_votes set voter_handle = v_handle where lower(voter_handle) = v_previous;
  update public.messages set sender_handle = v_handle
   where sender_profile_id = v_profile.id and lower(sender_handle) = v_previous;
  update public.notifications set recipient_handle = v_handle where recipient_handle = v_previous;

  return jsonb_build_object('ok', true, 'profile_id', v_profile.id, 'previous_handle', v_previous, 'handle', v_handle);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'taken', 'error', 'That handle is already taken.');
end;
$$;

revoke all on function public.rename_pubmaxx_handle(uuid, text)
  from public, anon, authenticated;
grant execute on function public.rename_pubmaxx_handle(uuid, text)
  to service_role;

commit;
