-- 0183: a Social post can carry one video, held until a person has watched it.
-- Captain applies. Agents ship SQL only.
--
-- WHY HELD. Post text and photos are screened by a model before anyone sees
-- them (lib/socialPostModeration.ts). Nothing screens a video, so a video is
-- shown to its author at once and to everybody else only after a moderator
-- approves it. A rejected video stays hidden; the post's words stay up.
--
-- HOW THE BYTES ARRIVE. A video is far larger than a serverless request body,
-- so the browser uploads it straight to Storage against a one-off intent:
--   1. create_social_video_upload() records the owner, type and declared size
--      and returns the object key the signed upload URL is minted for.
--   2. The post is created as usual; attach_social_post_video() then binds an
--      unclaimed, unexpired intent the same owner holds to that owner's post.
-- The route checks the stored object's size and leading bytes before it
-- calls step 2, so a declared type is never taken on trust.
--
-- WHO READS WHAT. read_social_post_videos() answers for posts the caller has
-- already been allowed to read: an approved video to anybody, a held or
-- rejected one only to its author. Browser roles hold nothing.
--
-- Reverse: supabase/migrations/rollback/20261017140000_0183_social_post_videos_rollback.sql

begin;

create table public.social_video_uploads (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  object_key text not null unique check (object_key ~ '^social-video/[0-9a-f-]{36}/video\.(mp4|webm|mov)$'),
  content_type text not null check (content_type in ('video/mp4', 'video/webm', 'video/quicktime')),
  declared_bytes bigint not null check (declared_bytes between 1 and 104857600),
  claimed_post_id uuid references public.social_posts(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours'
);

create index social_video_uploads_owner_idx
  on public.social_video_uploads (owner_profile_id, created_at desc);

create table public.social_post_videos (
  post_id uuid primary key references public.social_posts(id) on delete cascade,
  author_profile_id uuid not null references public.profiles(id) on delete cascade,
  upload_id uuid not null unique references public.social_video_uploads(id) on delete restrict,
  object_key text not null,
  content_type text not null check (content_type in ('video/mp4', 'video/webm', 'video/quicktime')),
  byte_size bigint not null check (byte_size between 1 and 104857600),
  duration_seconds numeric(6,2) check (duration_seconds is null or (duration_seconds > 0 and duration_seconds <= 600)),
  review_state text not null default 'held' check (review_state in ('held', 'approved', 'rejected')),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index social_post_videos_held_idx
  on public.social_post_videos (created_at)
  where review_state = 'held';

alter table public.social_video_uploads enable row level security;
alter table public.social_post_videos enable row level security;
revoke all on table public.social_video_uploads, public.social_post_videos
  from public, anon, authenticated;
grant select, insert, update, delete on table public.social_video_uploads, public.social_post_videos
  to service_role;

create function public.create_social_video_upload(
  p_owner_profile_id uuid, p_content_type text, p_declared_bytes bigint
)
returns table(upload_id uuid, object_key text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
  v_ext text;
begin
  v_ext := case p_content_type
    when 'video/mp4' then 'mp4'
    when 'video/webm' then 'webm'
    when 'video/quicktime' then 'mov'
  end;
  if v_ext is null then raise exception 'invalid Social video type'; end if;
  if p_declared_bytes is null or p_declared_bytes < 1 or p_declared_bytes > 104857600 then
    raise exception 'invalid Social video size';
  end if;
  if (select count(*) from public.social_video_uploads u
       where u.owner_profile_id = p_owner_profile_id
         and u.claimed_post_id is null
         and u.expires_at > now()) >= 5 then
    raise exception 'too many open Social video uploads';
  end if;
  return query
    insert into public.social_video_uploads as u (id, owner_profile_id, object_key, content_type, declared_bytes)
    values (v_id, p_owner_profile_id, 'social-video/' || v_id || '/video.' || v_ext, p_content_type, p_declared_bytes)
    returning u.id, u.object_key;
end;
$$;

create function public.attach_social_post_video(
  p_post_id uuid, p_owner_profile_id uuid, p_upload_id uuid, p_byte_size bigint, p_duration_seconds numeric
)
returns table(post_id uuid, review_state text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.social_posts%rowtype;
  v_upload public.social_video_uploads%rowtype;
begin
  select * into v_post from public.social_posts where id = p_post_id for update;
  if not found or v_post.author_profile_id <> p_owner_profile_id or v_post.status = 'removed' then
    raise exception 'Social video post not found';
  end if;
  select * into v_upload from public.social_video_uploads where id = p_upload_id for update;
  if not found or v_upload.owner_profile_id <> p_owner_profile_id
     or v_upload.claimed_post_id is not null or v_upload.expires_at <= now() then
    raise exception 'Social video upload not found';
  end if;
  if p_byte_size is null or p_byte_size < 1 or p_byte_size > v_upload.declared_bytes then
    raise exception 'invalid Social video size';
  end if;
  if p_duration_seconds is not null and (p_duration_seconds <= 0 or p_duration_seconds > 600) then
    raise exception 'invalid Social video duration';
  end if;
  update public.social_video_uploads set claimed_post_id = p_post_id where id = p_upload_id;
  return query
    insert into public.social_post_videos as v
      (post_id, author_profile_id, upload_id, object_key, content_type, byte_size, duration_seconds)
    values
      (p_post_id, p_owner_profile_id, p_upload_id, v_upload.object_key, v_upload.content_type, p_byte_size, p_duration_seconds)
    returning v.post_id, v.review_state;
end;
$$;

create function public.read_social_post_videos(p_post_ids uuid[], p_viewer_profile_id uuid)
returns table(post_id uuid, object_key text, content_type text, duration_seconds numeric, review_state text)
language sql
stable
security definer
set search_path = public
as $$
  select v.post_id, v.object_key, v.content_type, v.duration_seconds, v.review_state
  from public.social_post_videos v
  where v.post_id = any(p_post_ids)
    and (v.review_state = 'approved' or v.author_profile_id = p_viewer_profile_id);
$$;

create function public.review_social_post_video(p_post_id uuid, p_decision text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid Social video decision';
  end if;
  update public.social_post_videos
     set review_state = p_decision, reviewed_at = now()
   where post_id = p_post_id;
  return found;
end;
$$;

create function public.read_held_social_post_videos(p_limit integer)
returns table(post_id uuid, author_profile_id uuid, object_key text, content_type text, byte_size bigint, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select v.post_id, v.author_profile_id, v.object_key, v.content_type, v.byte_size, v.created_at
  from public.social_post_videos v
  join public.social_posts p on p.id = v.post_id
  where v.review_state = 'held' and p.status <> 'removed'
  order by v.created_at
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke all on function public.create_social_video_upload(uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.attach_social_post_video(uuid, uuid, uuid, bigint, numeric) from public, anon, authenticated;
revoke all on function public.read_social_post_videos(uuid[], uuid) from public, anon, authenticated;
revoke all on function public.review_social_post_video(uuid, text) from public, anon, authenticated;
revoke all on function public.read_held_social_post_videos(integer) from public, anon, authenticated;
grant execute on function public.create_social_video_upload(uuid, text, bigint) to service_role;
grant execute on function public.attach_social_post_video(uuid, uuid, uuid, bigint, numeric) to service_role;
grant execute on function public.read_social_post_videos(uuid[], uuid) to service_role;
grant execute on function public.review_social_post_video(uuid, text) to service_role;
grant execute on function public.read_held_social_post_videos(integer) to service_role;

commit;
