-- Realtime authorization for the two messaging topics (adversarial review F-1).
--
-- Apply AFTER 0147. Captain applies; agents ship SQL only.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT WAS WRONG. `public.messages` and `public.conversations` are RLS deny-all
-- with no policies and are outside the `supabase_realtime` publication (0019),
-- precisely so a browser holding the public key cannot read a DM. The messaging
-- realtime lane routed around that by hand: the server sent a payload-free
-- Broadcast on `live:inbox:<handle>` and `live:messages:<id>`, and the browser
-- subscribed to the same topics on PUBLIC channels. A public channel authorises
-- on the API key ALONE. Handles are public and enumerable (GET
-- /api/profiles/directory), so one anon-key websocket on `live:inbox:<victim>`
-- was a live activity oracle on a named person: pinged the instant they sent or
-- received a message. Both participants' inbox topics ride one batched send, so
-- two handles pinging together are in one conversation, and subscribing to many
-- handles reconstructed the private messaging graph without reading a single
-- message body. The payload was never the leak. The metadata was.
--
-- WHAT THIS DOES. Both halves now speak PRIVATE (lib/messagesBroadcast.server.ts,
-- lib/messagesRealtime.ts). Realtime then runs its own authorization check for
-- every join and every send, as the CALLER's role, against `realtime.messages`.
-- This migration is the policy that check reads:
--   • `live:inbox:<handle>`     → only the account that owns that handle.
--   • `live:messages:<uuid>`    → only a participant of that conversation.
--   • anything else             → no opinion (see the permissive note below).
-- The service role bypasses RLS, so the server's own broadcast is unaffected.
--
-- IT IS PERMISSIVE, AND THAT IS THE POINT. A policy can only ever ADMIT. This
-- one names our two topic families and answers false for everything else, so a
-- future private channel elsewhere in the app is neither admitted nor denied by
-- it — it simply needs its own policy, exactly as it would have without this.
--
-- THE PREDICATE LIVES IN pubmax_private, NOT public. 0070 moved every RLS helper
-- there and the policies read it there; a copy in `public` is a copy no policy
-- reads (that was the 0144 hole). It takes the topic as a PARAMETER rather than
-- calling realtime.topic() itself, so the helper is creatable and provable on a
-- cluster that has no realtime schema at all, and the policy is the one place
-- the two are joined.
--
-- Reverse: supabase/migrations/rollback/20260905180000_0148_messaging_realtime_authorization_rollback.sql

begin;

-- ── the predicate ────────────────────────────────────────────────────────────
-- SECURITY DEFINER for the reason every helper in 0065 is: a policy must be able
-- to look a conversation up without recursing into RLS on that table. It reads
-- auth.uid() from the calling session through the two helpers it delegates to,
-- never a parameter a client could forge as somebody else's identity.
--
-- The conversation id is matched as a UUID SHAPE before it is cast. A topic is
-- caller-supplied text, and `'live:messages:' || anything` reaching `::uuid`
-- would raise 22P02 inside a policy, which Realtime reads as a refusal but logs
-- as an error on every malformed join. A shape guard answers false quietly.
create or replace function pubmax_private.rls_may_read_messaging_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_topic is null then false
    when p_topic like 'live:inbox:%'
      then pubmax_private.rls_owns_handle(substring(p_topic from 12))
    when p_topic ~ '^live:messages:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then pubmax_private.rls_is_conversation_participant(
        (substring(p_topic from 15))::uuid
      )
    else false
  end;
$$;

revoke execute on function pubmax_private.rls_may_read_messaging_topic(text)
  from public, anon;
grant execute on function pubmax_private.rls_may_read_messaging_topic(text)
  to authenticated, service_role;

-- ── the policy ───────────────────────────────────────────────────────────────
-- `realtime.messages` is a platform table. It exists on every Supabase project
-- and in the effective-test fixture (scripts/rls/session-fixture.sql), which
-- stands in for the platform. If it is absent the messaging lane has NO
-- authorization at all, and a security policy that quietly did not install is
-- worse than one that refuses to, so this SAYS SO rather than skipping.
do $$
begin
  if to_regclass('realtime.messages') is null then
    raise exception
      'realtime.messages is absent; 0148 cannot install the messaging channel policy'
      using hint = 'Apply on a Supabase project, or load scripts/rls/session-fixture.sql first.';
  end if;

  execute 'drop policy if exists pubmax_messaging_topics_read on realtime.messages';
  execute $policy$
    create policy pubmax_messaging_topics_read
      on realtime.messages
      for select
      to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and pubmax_private.rls_may_read_messaging_topic(realtime.topic())
      )
  $policy$;
end $$;

commit;
