-- 0227: a status and its timestamp cannot contradict (state machine ship SM-12).
--
-- Each pair below has one writer path today, and every writer already keeps
-- the pair together. These CHECKs make that a database rule:
--   social_post_videos      held iff reviewed_at is null
--   venue_submissions       pending iff reviewed_at is null
--   wanteds                 open iff fulfilled_at is null
--   analytics_event_receipts delivered iff delivered_at is set
--   social_posts            pending moderation iff moderated_at is null
--   regular_night_reports   open has no confirmed_at, confirmed has one; a
--                           hidden report may keep the confirmed_at it earned
--
-- Each constraint is added NOT VALID, then VALIDATEd. A production row that
-- breaks a pair makes VALIDATE fail and the whole migration roll back, so the
-- read-only counts in the PR body run first.
--
-- It also fixes the 0224 reopen: a resolved person report filed again goes
-- back to queued and now drops resolved_at and resolved_by_staff_role_id.
-- Requires 0224 (the profile report kind and this function's 0224 body).

begin;

alter table public.social_post_videos drop constraint if exists social_post_videos_review_pair_check;
alter table public.social_post_videos add constraint social_post_videos_review_pair_check
  check ((review_state = 'held') = (reviewed_at is null)) not valid;
alter table public.venue_submissions drop constraint if exists venue_submissions_review_pair_check;
alter table public.venue_submissions add constraint venue_submissions_review_pair_check
  check ((status = 'pending') = (reviewed_at is null)) not valid;
alter table public.wanteds drop constraint if exists wanteds_fulfilled_pair_check;
alter table public.wanteds add constraint wanteds_fulfilled_pair_check
  check ((status = 'open') = (fulfilled_at is null)) not valid;
alter table public.analytics_event_receipts drop constraint if exists analytics_event_receipts_delivered_pair_check;
alter table public.analytics_event_receipts add constraint analytics_event_receipts_delivered_pair_check
  check ((status = 'delivered') = (delivered_at is not null)) not valid;
alter table public.social_posts drop constraint if exists social_posts_moderated_pair_check;
alter table public.social_posts add constraint social_posts_moderated_pair_check
  check ((moderation_state = 'pending') = (moderated_at is null)) not valid;
alter table public.regular_night_reports drop constraint if exists regular_night_reports_confirmed_pair_check;
alter table public.regular_night_reports add constraint regular_night_reports_confirmed_pair_check
  check ((status = 'open' and confirmed_at is null) or (status = 'confirmed' and confirmed_at is not null) or status = 'hidden') not valid;

alter table public.social_post_videos validate constraint social_post_videos_review_pair_check;
alter table public.venue_submissions validate constraint venue_submissions_review_pair_check;
alter table public.wanteds validate constraint wanteds_fulfilled_pair_check;
alter table public.analytics_event_receipts validate constraint analytics_event_receipts_delivered_pair_check;
alter table public.social_posts validate constraint social_posts_moderated_pair_check;
alter table public.regular_night_reports validate constraint regular_night_reports_confirmed_pair_check;

-- A reopened person report that 0224 left with a resolution stamp.
update public.social_content_reports
set resolved_at = null, resolved_by_staff_role_id = null
where content_kind = 'profile' and state = 'queued'
  and (resolved_at is not null or resolved_by_staff_role_id is not null);

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
  end,
  -- 0227: a reopened report is no longer resolved, so it carries no resolution.
  resolved_at = case
    when excluded.content_kind = 'profile' and social_content_reports.state = 'resolved' then null
    else social_content_reports.resolved_at
  end,
  resolved_by_staff_role_id = case
    when excluded.content_kind = 'profile' and social_content_reports.state = 'resolved' then null
    else social_content_reports.resolved_by_staff_role_id
  end
  returning * into v_row;
  return next v_row;
end;
$$;

commit;
