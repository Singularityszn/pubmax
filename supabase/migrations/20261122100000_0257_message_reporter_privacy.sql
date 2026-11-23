-- 0257: a thread participant reads the thread, never who reported a message.
-- Captain applies; agents ship SQL only.
--
-- Reverse: supabase/migrations/rollback/20261122090000_0257_message_reporter_privacy_rollback.sql
--
-- `messages.flagged_by` holds the reporter's handle. 0172 granted SELECT on the
-- whole table to `authenticated`, and the participant policy admits every member
-- of a thread, so in a group thread the reported sender could read who reported
-- them. The API already returns only `flagged`. This grants every column except
-- `flagged_by`. Revoking the table privilege also clears its column privileges,
-- so a second run leaves the same grants. The service role keeps the column for
-- the moderator queue. A column added later starts with no browser grant.

begin;

revoke select on table public.messages from public, anon, authenticated;

grant select (
  id,
  conversation_id,
  sender_handle,
  sender_user_id,
  body,
  created_at,
  read_at,
  flagged_at,
  attachment_kind,
  attachment_object_key,
  attachment_width,
  attachment_height,
  attachment_venue_id,
  client_message_id,
  sender_profile_id,
  attachment_contact_handle,
  attachment_plan_id,
  attachment_poll_question,
  attachment_poll_options,
  unsent_at
) on table public.messages to authenticated;

commit;
