-- Rollback for 0191 (Social posts with the author's name hidden).
--
-- Puts 0188's `read_social_post_feed` back byte for byte, drops the
-- hidden-name create door, the shape CHECK and the column.
--
-- WHAT IT COSTS. Dropping the column would print every hidden-name post under
-- its author's handle, which is the one thing those authors asked us not to
-- do. So this file FIRST takes every hidden-name post out of every read
-- (`status = 'hidden'`, the moderator's hide: the author still sees it in their
-- own outbox and export, and nobody else does). Those posts stay hidden after
-- a re-apply, because nothing remembers which hidden posts were hidden-name
-- posts. That is a lost post, never a disclosure. Safe to re-run.

begin;

do $$
begin
  if exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'social_posts'
      and column_name = 'author_name_hidden') then
    execute $sql$update public.social_posts
      set status = 'hidden', updated_at = now()
      where author_name_hidden and status = 'visible'$sql$;
  end if;
end;
$$;

drop function if exists public.create_social_post_hidden_name(
  uuid,text,text,text,text,text,text,text[],text,uuid,text,text,integer,integer,integer,text,text[],text,text
);

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
    and not exists (select 1 from public.social_mutes mute
      where mute.muter_profile_id = p_viewer_profile_id
        and mute.muted_profile_id = post.author_profile_id)
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

alter table public.social_posts drop constraint if exists social_posts_hidden_name_shape;
alter table public.social_posts drop column if exists author_name_hidden;

commit;
