begin;

-- Reverses 20261107220000_0224_social_safety_moderation.sql.
--
-- COST, read before applying:
-- - Every person report ('profile') is DELETED, because the 0073 kind check
--   cannot hold one. Post, comment and quote reports stay.
-- - The suspend and evidence audit ledgers and flagged DM reviews are DROPPED. Every
--   flagged DM shows as unreviewed again.
-- - An account this release suspended STAYS suspended. Nothing here guesses
--   which suspensions to undo; reinstate by hand before rolling back if needed.

drop function if exists public.set_social_account_suspension_admin(uuid, uuid, text, text, uuid);
drop function if exists public.review_flagged_message_admin(uuid, uuid);
drop function if exists public.read_flagged_message_evidence_admin(uuid, uuid);
drop function if exists public.read_flagged_messages_admin(uuid, integer);
drop function if exists public.resolve_social_report_admin(uuid, uuid);
drop function if exists public.read_social_report_queue_admin(uuid, integer);
drop function if exists public.read_reported_content_evidence_admin(uuid, uuid);

drop table if exists public.social_account_moderation_audit;
drop table if exists public.message_flag_evidence_audit;
drop table if exists public.message_flag_reviews;
drop table if exists public.social_report_evidence_audit;
drop index if exists public.messages_flagged_at_idx;

delete from public.social_content_reports where content_kind = 'profile';
alter table public.social_content_reports
  drop constraint if exists social_content_reports_content_kind_check;
alter table public.social_content_reports
  add constraint social_content_reports_content_kind_check
  check (content_kind in ('post', 'comment', 'quote'));

-- report_social_content as 0073 wrote it.
create or replace function public.report_social_content(p_actor uuid, p_kind text, p_content_id uuid, p_reason text)
returns setof public.social_content_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visible boolean := false;
  v_row public.social_content_reports;
begin
  if p_kind = 'post' then
    select public.social_post_readable(post, p_actor) and not public.social_interaction_blocked(p_actor, post.author_profile_id)
    into v_visible from public.social_posts post where post.id = p_content_id;
  elsif p_kind = 'comment' then
    select comment.status = 'visible' and comment.moderation_state = 'approved'
      and public.social_post_readable(post, p_actor)
      and not public.social_interaction_blocked(p_actor, comment.author_profile_id)
      and not public.social_interaction_blocked(p_actor, post.author_profile_id)
    into v_visible from public.social_comments comment join public.social_posts post on post.id = comment.post_id where comment.id = p_content_id;
  elsif p_kind = 'quote' then
    select quote.status = 'visible' and quote.moderation_state = 'approved'
      and public.social_post_readable(post, p_actor)
      and not public.social_interaction_blocked(p_actor, quote.author_profile_id)
      and not public.social_interaction_blocked(p_actor, post.author_profile_id)
      and (
        quote.author_profile_id = p_actor
        or quote.visibility = 'public'
        or (
          quote.visibility = 'friends'
          and exists(select 1 from public.follows where follower_id = p_actor and followee_id = quote.author_profile_id)
          and exists(select 1 from public.follows where follower_id = quote.author_profile_id and followee_id = p_actor)
        )
      )
    into v_visible from public.social_quotes quote join public.social_posts post on post.id = quote.source_post_id where quote.id = p_content_id;
  end if;
  if not coalesce(v_visible, false) then raise exception 'content not found'; end if;
  insert into public.social_content_reports(reporter_profile_id, content_kind, content_id, reason)
  values (p_actor, p_kind, p_content_id, p_reason)
  on conflict (reporter_profile_id, content_kind, content_id, reason) do update set reason = excluded.reason
  returning * into v_row;
  return next v_row;
end;
$$;

commit;
