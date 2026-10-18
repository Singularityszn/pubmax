-- 0185: a Social post can carry up to four photos, the first and three more.
-- Captain applies. Agents ship SQL only.
--
-- THE FIRST PHOTO IS UNCHANGED. It stays social_posts.photo_media_id with
-- every rule 0074 gave it: its consent tags, its moderation job, its detach
-- and purge lifecycle. Positions 2 to 4 live here, so nothing that already
-- reads or moderates a post moves.
--
-- EACH EXTRA PHOTO IS SCREENED ON ITS OWN. A row starts pending and is shown
-- to its author at once and to anybody else only once its own model check
-- approves it (claim_ / complete_social_extra_photo_moderation, drained by the
-- same cron as posts). A held photo stays with its author; the post and its
-- other photos stay up.
--
-- WHO READS WHAT. An extra photo is readable exactly when its post is
-- (social_post_readable) and neither side has blocked the other, and only
-- once approved; its author always reads their own.
--
-- Bytes live under social-extra/<media id>/image.jpg in the same bucket,
-- normalised to JPEG by the same pipeline as the first photo.
--
-- Reverse: supabase/migrations/rollback/20261017160000_0185_social_post_extra_photos_rollback.sql

begin;

create table public.social_post_extra_photos (
  media_id uuid primary key,
  post_id uuid not null references public.social_posts(id) on delete cascade,
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  position smallint not null check (position between 2 and 4),
  object_key text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  width integer not null check (width between 1 and 1200),
  height integer not null check (height between 1 and 1200),
  byte_size integer not null check (byte_size > 0 and byte_size <= 10485760),
  alt_text text not null check (char_length(alt_text) between 1 and 300),
  moderation_state text not null default 'pending'
    check (moderation_state in ('pending', 'approved', 'needs_review')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  unique (post_id, position),
  constraint social_post_extra_photos_path_check check (
    object_key = 'social-extra/' || media_id::text || '/image.jpg'
  )
);

create index social_post_extra_photos_pending_idx
  on public.social_post_extra_photos (next_attempt_at)
  where moderation_state = 'pending';

alter table public.social_post_extra_photos enable row level security;
revoke all on table public.social_post_extra_photos from public, anon, authenticated;
grant select, insert, update, delete on table public.social_post_extra_photos to service_role;

create function public.attach_social_post_extra_photo(
  p_post_id uuid, p_owner_profile_id uuid, p_media_id uuid, p_position integer,
  p_sha256 text, p_width integer, p_height integer, p_byte_size integer, p_alt_text text
)
returns table(media_id uuid, object_key text, moderation_state text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.social_posts%rowtype;
begin
  select * into v_post from public.social_posts where id = p_post_id for update;
  if not found or v_post.author_profile_id <> p_owner_profile_id or v_post.status = 'removed' then
    raise exception 'Social extra photo post not found';
  end if;
  if v_post.photo_media_id is null then
    raise exception 'Social extra photo needs a first photo';
  end if;
  if p_position is null or p_position < 2 or p_position > 4 then
    raise exception 'invalid Social extra photo position';
  end if;
  return query
    insert into public.social_post_extra_photos as photo
      (media_id, post_id, owner_profile_id, position, object_key, sha256, width, height, byte_size, alt_text)
    values
      (p_media_id, p_post_id, p_owner_profile_id, p_position,
       'social-extra/' || p_media_id::text || '/image.jpg',
       p_sha256, p_width, p_height, p_byte_size, p_alt_text)
    returning photo.media_id, photo.object_key, photo.moderation_state;
end;
$$;

create function public.read_social_post_extra_photos(p_post_ids uuid[], p_viewer_profile_id uuid)
returns table(post_id uuid, media_id uuid, slot smallint, alt_text text, moderation_state text)
language sql
stable
security definer
set search_path = public
as $$
  select photo.post_id, photo.media_id, photo.position, photo.alt_text, photo.moderation_state
  from public.social_post_extra_photos photo
  join public.social_posts post on post.id = photo.post_id
  where photo.post_id = any(p_post_ids)
    and (
      photo.owner_profile_id = p_viewer_profile_id
      or (
        photo.moderation_state = 'approved'
        and public.social_post_readable(post, p_viewer_profile_id)
        and not public.social_interaction_blocked(p_viewer_profile_id, post.author_profile_id)
      )
    )
  order by photo.post_id, photo.position;
$$;

create function public.read_social_post_extra_photo_object(p_viewer_profile_id uuid, p_media_id uuid)
returns table(object_key text)
language sql
stable
security definer
set search_path = public
as $$
  select photo.object_key
  from public.social_post_extra_photos photo
  join public.social_posts post on post.id = photo.post_id
  where photo.media_id = p_media_id
    and post.status <> 'removed'
    and (
      photo.owner_profile_id = p_viewer_profile_id
      or (
        photo.moderation_state = 'approved'
        and public.social_post_readable(post, p_viewer_profile_id)
        and not public.social_interaction_blocked(p_viewer_profile_id, post.author_profile_id)
      )
    );
$$;

create function public.claim_social_extra_photo_moderation(p_limit integer)
returns table(media_id uuid, post_id uuid, object_key text, alt_text text, attempts integer, lease_token uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then raise exception 'invalid moderation batch size'; end if;
  return query
  with candidates as (
    select photo.media_id from public.social_post_extra_photos photo
    join public.social_posts post on post.id = photo.post_id
    where photo.moderation_state = 'pending'
      and post.status <> 'removed'
      and photo.next_attempt_at <= now()
      and (photo.lease_until is null or photo.lease_until < now())
    order by photo.next_attempt_at, photo.created_at
    for update of photo skip locked
    limit p_limit
  )
  update public.social_post_extra_photos photo
     set attempts = photo.attempts + 1,
         lease_token = gen_random_uuid(),
         lease_until = now() + interval '5 minutes'
    from candidates
   where photo.media_id = candidates.media_id
  returning photo.media_id, photo.post_id, photo.object_key, photo.alt_text, photo.attempts, photo.lease_token;
end;
$$;

create function public.complete_social_extra_photo_moderation(
  p_media_id uuid, p_lease_token uuid, p_decision text, p_retry_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_decision is not null and p_decision not in ('approved', 'needs_review') then
    raise exception 'invalid moderation decision';
  end if;
  update public.social_post_extra_photos
     set moderation_state = coalesce(p_decision, moderation_state),
         next_attempt_at = case when p_decision is null then coalesce(p_retry_at, now() + interval '1 hour') else next_attempt_at end,
         lease_token = null,
         lease_until = null
   where media_id = p_media_id and lease_token = p_lease_token and moderation_state = 'pending';
  return found;
end;
$$;

revoke all on function public.attach_social_post_extra_photo(uuid, uuid, uuid, integer, text, integer, integer, integer, text) from public, anon, authenticated;
revoke all on function public.read_social_post_extra_photos(uuid[], uuid) from public, anon, authenticated;
revoke all on function public.read_social_post_extra_photo_object(uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_social_extra_photo_moderation(integer) from public, anon, authenticated;
revoke all on function public.complete_social_extra_photo_moderation(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.attach_social_post_extra_photo(uuid, uuid, uuid, integer, text, integer, integer, integer, text) to service_role;
grant execute on function public.read_social_post_extra_photos(uuid[], uuid) to service_role;
grant execute on function public.read_social_post_extra_photo_object(uuid, uuid) to service_role;
grant execute on function public.claim_social_extra_photo_moderation(integer) to service_role;
grant execute on function public.complete_social_extra_photo_moderation(uuid, uuid, text, timestamptz) to service_role;

commit;
