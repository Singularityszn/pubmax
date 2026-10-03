-- Puts back the client writes 0172 removed from the tables that still
-- carry an owner write policy or took a default write grant, and PUBLIC
-- execute on report_pint_drop. It does not put back every grant 0172
-- revoked.
--
-- Cost: anon can again insert, update and delete conversation_members,
-- message_poll_votes and crawl_stories, and authenticated can again write
-- the owner tables 0172 closed (saved pubs, follows, check-ins, saved lists,
-- notifications, pub pals, night profiles, wanteds, step-out prefs, and the
-- two messaging tables). Row policy is the only check on those writes.
-- SELECT grants 0172 kept are left as they are.
--
-- Not restored, on purpose. Each is a grant no client path or policy
-- serves, and putting it back reopens the hole 0172 closes.
--   • TRUNCATE, REFERENCES and TRIGGER on every public table. TRUNCATE
--     wipes a table under any row policy. The session-fixture replay never
--     had them.
--   • anon SELECT on conversation_members and message_poll_votes. No
--     policy admits anon there, so the grant answered zero rows.
--   • Any other browser-role grant on a public table that a hosted catalog
--     held outside the migration history. The replay shows none: before
--     0172 every browser-role table grant is on a table 0172 keeps a SELECT
--     on or writes back below. A hosted grant no migration wrote is not
--     recorded anywhere, so this file cannot name it.
--   • Browser-role grants on public sequences. The replay shows none; the
--     platform default granted them, and no client path calls nextval.
--   • The default privileges 0172 revoked. They act only on objects a
--     later migration creates, so leaving them revoked breaks nothing that
--     exists, and restoring them reopens the default that produced 0170
--     and 0171.
-- pub_presence SELECT is not on this list because 0172 did not take it:
-- 0068 revoked it and nothing granted it back.
--
-- report_pint_drop gets PUBLIC execute back. It stayed SECURITY INVOKER, so
-- a signed-in call depends on a pint_drops grant again and fails while 0171
-- stays applied.
--
-- service_role is untouched.

begin;

grant insert, delete on table public.check_ins to authenticated;
grant insert, update, delete on table public.conversation_members to anon, authenticated;
grant insert, update, delete on table public.crawl_stories to anon, authenticated;
grant insert, delete on table public.follows to authenticated;
grant insert, update, delete on table public.message_poll_votes to anon, authenticated;
grant insert, update, delete on table public.night_profiles to authenticated;
grant update on table public.notifications to authenticated;
grant insert on table public.pub_pal_mastery_events to authenticated;
grant insert, update, delete on table public.pub_pal_memories to authenticated;
grant insert, update, delete on table public.pub_pals to authenticated;
grant insert, delete on table public.saved_list_follows to authenticated;
grant insert, update, delete on table public.saved_lists to authenticated;
grant insert, update, delete on table public.saved_pubs to authenticated;
grant insert, update, delete on table public.step_out_nudge_prefs to authenticated;
grant insert, update, delete on table public.wanteds to authenticated;

grant execute on function public.report_pint_drop(uuid, text, int) to public;

commit;
