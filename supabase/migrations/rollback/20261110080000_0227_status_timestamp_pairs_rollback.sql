-- Reverses 20261110080000_0227_status_timestamp_pairs.sql.
--
-- COST, read before applying:
-- - The six status and timestamp pair CHECKs are dropped. No row changes.
-- - report_social_content returns to its 0224 body: a reopened person report
--   keeps its old resolved_at and resolved_by_staff_role_id again. Stamps that
--   0227 cleared on reopened reports are not restored; nothing reads them.

begin;

alter table public.social_post_videos drop constraint if exists social_post_videos_review_pair_check;
alter table public.venue_submissions drop constraint if exists venue_submissions_review_pair_check;
alter table public.wanteds drop constraint if exists wanteds_fulfilled_pair_check;
alter table public.analytics_event_receipts drop constraint if exists analytics_event_receipts_delivered_pair_check;
alter table public.social_posts drop constraint if exists social_posts_moderated_pair_check;
alter table public.regular_night_reports drop constraint if exists regular_night_reports_confirmed_pair_check;

-- report_social_content as 0224 wrote it.
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
  elsif p_kind = 'profile' then
    -- 0224: a person. Any profile but the reporter's own, blocked or not.
    select profile.id <> p_actor
    into v_visible from public.profiles profile where profile.id = p_content_id;
  end if;
  if not coalesce(v_visible, false) then raise exception 'content not found'; end if;
  insert into public.social_content_reports(reporter_profile_id, content_kind, content_id, reason)
  values (p_actor, p_kind, p_content_id, p_reason)
  on conflict (reporter_profile_id, content_kind, content_id, reason) do update
  set state = case
    when excluded.content_kind = 'profile' and social_content_reports.state = 'resolved' then 'queued'
    else social_content_reports.state
  end
  returning * into v_row;
  return next v_row;
end;
$$;

commit;
