-- Social posts with the author's name hidden (0191). Apply AFTER 0188.
-- Captain applies; agents ship SQL only.
--
-- Reverse: supabase/migrations/rollback/20261018120000_0191_social_post_hidden_name_rollback.sql
--
-- WHAT A HIDDEN-NAME POST IS. A Social Post whose author chose, at the moment
-- of posting, that other readers see "a PUBMAXXER" instead of their handle.
-- It is hidden from READERS, never from PUBMAXX: the row still carries
-- `author_profile_id` and `author_handle`, the author must still be a signed-in
-- adult, every post is still moderated before anybody reads it, a moderator
-- still sees the handle, and a report still reaches the real account. The
-- reading rule is `socialPostDTO` in `lib/socialPosts.ts`; this file only
-- stores the choice and keeps the post out of the places that would name the
-- author by inference.
--
-- WHAT THIS DOES.
--   1. `social_posts.author_name_hidden`, NOT NULL, DEFAULT false, so every
--      existing row states what it already was. A constant default rewrites no
--      table on PostgreSQL 11 or later.
--   2. A CHECK: a hidden-name post is `public` and names no exact pub. A
--      friends-only post tells a reader the author is one of their mutuals, and
--      an exact pub beside a pub review names the reviewer, so both are refused
--      in the table as well as at the route.
--   3. `create_social_post_hidden_name(...)`, the create door for a hidden-name
--      post. It takes the idempotent create's arguments, refuses photo tags (a
--      tag shows the author's handle to the tagged person), calls
--      `create_social_post_idempotent` and stamps the flag IN THE SAME
--      TRANSACTION, so no moderator run can approve the post before the flag
--      is on it. A replay with the same key returns the same stamped row.
--   4. `read_social_post_feed` restated from 0188 with one more predicate: a
--      hidden-name post is never in the Following lane, because "somebody you
--      follow" is a short list and would name the author. It stays in Discover
--      and Nearby, which are public lanes. Order, cursor and every other rule
--      are byte for byte 0188's.
--
-- A deploy ahead of this apply cannot create a hidden-name post: the create
-- door does not exist, so the store refuses the post rather than publishing
-- it under the author's name. Every other read and write is unchanged.

begin;

alter table public.social_posts
  add column author_name_hidden boolean not null default false;

alter table public.social_posts
  add constraint social_posts_hidden_name_shape
  check (not author_name_hidden or (visibility = 'public' and venue_id is null));

create function public.create_social_post_hidden_name(
  p_author_profile_id uuid,p_author_handle text,p_kind text,p_visibility text,p_body text,
  p_area_slug text,p_venue_id text,p_hashtags text[],p_comment_policy text,p_media_id uuid,
  p_object_key text,p_sha256 text,p_width integer,p_height integer,p_byte_size integer,
  p_photo_alt_text text,p_tag_handles text[],p_idempotency_key text,p_request_digest text
)
returns setof public.social_posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.social_posts;
begin
  if coalesce(cardinality(p_tag_handles), 0) > 0 then
    raise exception 'hidden name post cannot tag people';
  end if;
  if p_visibility <> 'public' or p_venue_id is not null then
    raise exception 'hidden name post must be public and name no venue';
  end if;
  select * into v_post from public.create_social_post_idempotent(
    p_author_profile_id,p_author_handle,p_kind,p_visibility,p_body,
    p_area_slug,p_venue_id,p_hashtags,p_comment_policy,p_media_id,
    p_object_key,p_sha256,p_width,p_height,p_byte_size,
    p_photo_alt_text,p_tag_handles,p_idempotency_key,p_request_digest);
  if v_post.id is null then raise exception 'social post was not created'; end if;
  update public.social_posts set author_name_hidden = true
    where id = v_post.id
    returning * into v_post;
  return next v_post;
end;
$$;

revoke all on function public.create_social_post_hidden_name(
  uuid,text,text,text,text,text,text,text[],text,uuid,text,text,integer,integer,integer,text,text[],text,text
) from public, anon, authenticated;
grant execute on function public.create_social_post_hidden_name(
  uuid,text,text,text,text,text,text,text[],text,uuid,text,text,integer,integer,integer,text,text[],text,text
) to service_role;

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
      when 'following' then not post.author_name_hidden and exists (select 1 from public.follows
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

commit;
