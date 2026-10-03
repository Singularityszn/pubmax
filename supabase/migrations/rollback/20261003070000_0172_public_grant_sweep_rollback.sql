-- Puts back the client writes 0172 removed.
--
-- Cost: anon can again insert, update and delete conversation_members,
-- message_poll_votes and crawl_stories, and authenticated can again write
-- the owner tables 0172 closed (saved pubs, follows, check-ins, saved lists,
-- notifications, pub pals, night profiles, wanteds, step-out prefs, and the
-- two messaging tables). Row policy is the only check on those writes.
-- SELECT grants 0172 kept are left as they are.
--
-- TRUNCATE, REFERENCES and TRIGGER stay revoked. Granting them back is the
-- wipe 0172 exists to close; the session-fixture replay never had them.
--
-- report_pint_drop goes back to SECURITY INVOKER with PUBLIC execute, so a
-- signed-in call depends on a pint_drops grant again and fails while 0171
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

create or replace function public.report_pint_drop(
  p_id uuid,
  p_reason text,
  p_hide_threshold int
)
returns int
language sql
security invoker
set search_path = ''
as $$
  update public.pint_drops
     set report_count = coalesce(report_count, 0) + 1,
         reported_at = now(),
         report_reason = coalesce(nullif(p_reason, ''), report_reason),
         status = case
                    when coalesce(report_count, 0) + 1 >= p_hide_threshold
                      then 'hidden'
                    else status
                  end
   where id = p_id
   returning report_count;
$$;

grant execute on function public.report_pint_drop(uuid, text, int) to public;

commit;
