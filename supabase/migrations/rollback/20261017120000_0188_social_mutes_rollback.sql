-- Rollback for 0188 (Social mutes).
--
-- Puts 0074's `read_social_post_feed` back byte for byte, drops the two
-- functions and drops `public.social_mutes` with every mute in it. That COSTS
-- every account's mutes: nothing remembers who muted whom, so muted posts come
-- back into every lane at once and a re-apply starts from an empty table. It
-- discloses nothing, because no browser role ever held the table. Safe to
-- re-run.

begin;

create or replace function public.read_social_post_feed(
  p_viewer_profile_id uuid,
  p_lane text,
  p_area_slug text default null,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 20
)
returns setof public.social_posts
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_lane not in ('discover', 'nearby', 'following')
    or p_limit < 1 or p_limit > 51
    or (p_lane = 'nearby' and p_area_slug is null)
    or ((p_before_created_at is null) <> (p_before_id is null))
  then raise exception 'invalid social feed request';
  end if;
  return query
  select projected.*
  from public.social_posts post
  cross join lateral jsonb_populate_record(
    null::public.social_posts,
    to_jsonb(post) || jsonb_build_object(
      'venue_id', case when public.social_post_exact_venue_allowed(post, p_viewer_profile_id)
        then post.venue_id else null end
    )
  ) projected
  where public.social_post_readable(post, p_viewer_profile_id)
    and not public.social_interaction_blocked(p_viewer_profile_id, post.author_profile_id)
    and (p_before_created_at is null or (post.created_at, post.id) < (p_before_created_at, p_before_id))
    and case p_lane
      when 'discover' then post.visibility = 'public'
      when 'nearby' then post.visibility = 'public' and post.area_slug = p_area_slug
      when 'following' then exists (select 1 from public.follows
        where follower_id = p_viewer_profile_id and followee_id = post.author_profile_id)
        and (post.visibility = 'public' or (
          post.visibility = 'friends' and exists (select 1 from public.follows
            where follower_id = post.author_profile_id and followee_id = p_viewer_profile_id)
        ))
      else false
    end
  order by post.created_at desc, post.id desc
  limit p_limit;
end;
$$;

drop function if exists public.read_social_relationship(uuid, uuid);
drop function if exists public.set_social_mute(uuid, uuid, boolean);
drop table if exists public.social_mutes;

commit;
