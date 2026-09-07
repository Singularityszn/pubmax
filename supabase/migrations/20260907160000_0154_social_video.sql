-- Bounded MP4 attachments reuse the existing identity, audience, audit and cleanup transactions.
-- Apply before enabling video uploads. Browser roles remain API-only.
alter table public.social_post_media drop constraint social_post_media_width_check, drop constraint social_post_media_height_check;
alter table public.social_post_media add constraint social_post_media_width_check check(width between 1 and 1920),
  add constraint social_post_media_height_check check(height between 1 and 1920);
alter table public.social_post_media_uploads drop constraint social_post_media_uploads_width_check, drop constraint social_post_media_uploads_height_check;
alter table public.social_post_media_uploads add constraint social_post_media_uploads_width_check check(width between 1 and 1920),
  add constraint social_post_media_uploads_height_check check(height between 1 and 1920);
alter table public.social_post_media drop constraint social_post_media_content_type_check;
alter table public.social_post_media add column duration_seconds double precision;
alter table public.social_post_media_uploads add column content_type text not null default 'image/jpeg',
  add column duration_seconds double precision;
alter table public.social_posts add column photo_content_type text;

alter table public.social_post_media add constraint social_post_media_content_type_check check (
  (content_type='image/jpeg' and duration_seconds is null and width<=1200 and height<=1200) or
  (content_type='video/mp4' and duration_seconds > 0 and duration_seconds <= 15 and duration_seconds is not null and byte_size<=4194304)
);
alter table public.social_post_media_uploads add constraint social_post_upload_content_type_check check (
  (content_type='image/jpeg' and duration_seconds is null and width<=1200 and height<=1200) or
  (content_type='video/mp4' and duration_seconds > 0 and duration_seconds <= 15 and duration_seconds is not null and byte_size<=4194304)
);
alter table public.social_post_media drop constraint social_post_media_private_path_check;
alter table public.social_post_media add constraint social_post_media_private_path_check check (
  object_key='social/' || id::text || '/' || generation::text ||
    case when content_type='video/mp4' then '/video.mp4' else '/image.jpg' end
);
alter table public.social_post_media_uploads drop constraint social_post_media_upload_private_path_check;
alter table public.social_post_media_uploads add constraint social_post_media_upload_private_path_check check (
  object_key='social/' || media_id::text || '/' || generation::text ||
    case when content_type='video/mp4' then '/video.mp4' else '/image.jpg' end
);

-- Existing create/edit RPCs promote the reservation in one transaction.
create function public.bind_social_media_format() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  select upload.content_type,upload.duration_seconds into new.content_type,new.duration_seconds
  from public.social_post_media_uploads upload where upload.media_id=new.id
    and upload.generation=new.generation and upload.owner_profile_id=new.owner_profile_id
    and upload.object_key=new.object_key and upload.sha256=new.sha256
    and upload.width=new.width and upload.height=new.height and upload.byte_size=new.byte_size
    and upload.state='staged';
  if not found then
    if new.object_key like '%/video.mp4' then raise exception 'invalid Social video reservation'; end if;
    new.content_type := 'image/jpeg'; new.duration_seconds := null;
  end if;
  return new;
end; $$;
create trigger social_media_format before insert on public.social_post_media
for each row execute function public.bind_social_media_format();

create function public.bind_social_post_media_format() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  select content_type into new.photo_content_type from public.social_post_media where id=new.photo_media_id;
  return new;
end; $$;
create trigger social_post_media_format before insert or update on public.social_posts
for each row execute function public.bind_social_post_media_format();

create function public.refuse_social_video_tags() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.social_post_media where id=new.media_id and content_type='video/mp4') then
    raise exception 'invalid Social tags: videos do not support photo tags';
  end if;
  return new;
end; $$;
create trigger social_video_tags before insert on public.social_post_tag_proposals
for each row execute function public.refuse_social_video_tags();

create function public.reserve_social_post_video_upload(
  p_owner_profile_id uuid,p_media_id uuid,p_sha256 text,p_width integer,p_height integer,p_byte_size integer,p_duration_seconds double precision
)
returns table(media_id uuid,generation uuid,object_key text)
language plpgsql security definer set search_path=public as $$
declare v_upload public.social_post_media_uploads; v_generation uuid;
begin
  if p_duration_seconds is null or not (p_duration_seconds > 0 and p_duration_seconds <= 15)
    or p_byte_size is null or p_byte_size > 4194304 then raise exception 'invalid Social video'; end if;
  perform pg_advisory_xact_lock(hashtextextended('social-media-upload:' || p_media_id::text,0));
  select * into v_upload from public.social_post_media_uploads upload where upload.media_id=p_media_id for update;
  if v_upload.media_id is null then
    v_generation := gen_random_uuid();
    insert into public.social_post_media_uploads(
      media_id,generation,owner_profile_id,object_key,sha256,width,height,byte_size,content_type,duration_seconds
    ) values (
      p_media_id,v_generation,p_owner_profile_id,
      'social/' || p_media_id::text || '/' || v_generation::text || '/video.mp4',
      p_sha256,p_width,p_height,p_byte_size,'video/mp4',p_duration_seconds
    ) returning * into v_upload;
  elsif v_upload.owner_profile_id<>p_owner_profile_id or v_upload.sha256<>p_sha256
    or v_upload.width<>p_width or v_upload.height<>p_height or v_upload.byte_size<>p_byte_size
  then raise exception 'invalid Social photo reservation';
  elsif v_upload.content_type <> 'video/mp4' or v_upload.duration_seconds <> p_duration_seconds then
    raise exception 'invalid Social video reservation';
  elsif v_upload.state='cleanup' then
    raise exception 'Social photo cleanup in progress';
  end if;
  return query select v_upload.media_id,v_upload.generation,v_upload.object_key;
end; $$;


revoke all on function public.bind_social_media_format(),public.bind_social_post_media_format(),public.refuse_social_video_tags(),
 public.reserve_social_post_video_upload(uuid,uuid,text,integer,integer,integer,double precision) from public,anon,authenticated;
grant execute on function public.reserve_social_post_video_upload(uuid,uuid,text,integer,integer,integer,double precision) to service_role;

create or replace function public.queue_social_post_moderation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.moderation_state = 'pending' then
    insert into public.social_post_moderation_jobs(post_id, revision, media_id, moderation_claim)
    values (
      new.id,
      new.revision,
      new.photo_media_id,
      concat_ws(E'\n\n', nullif(new.body,''),
        case when cardinality(new.hashtags)>0 then '#' || array_to_string(new.hashtags,' #') end,
        case when new.photo_alt_text is not null then (case when new.photo_content_type='video/mp4' then 'Video: ' else 'Photo: ' end) || new.photo_alt_text end)
    )
    on conflict (post_id) do update set
      state = 'pending',
      revision = excluded.revision,
      media_id = excluded.media_id,
      moderation_claim = excluded.moderation_claim,
      attempts = 0,
      next_attempt_at = now(),
      lease_until = null,
      lease_token = null,
      last_error_code = null,
      updated_at = now();
  end if;
  return new;
end;
$$;

-- The media FK clears its reference during cleanup. Preserve every other audit field.
create function public.guard_social_moderation_audit_cleanup() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='UPDATE' and pg_trigger_depth()>1 and old.media_id is not null and new.media_id is null
    and (to_jsonb(new)-'media_id')=(to_jsonb(old)-'media_id')
    and not exists(select 1 from public.social_post_media where id=old.media_id) then
    return new;
  end if;
  raise exception 'append-only Social audit';
end; $$;
drop trigger social_post_moderation_actions_immutable on public.social_post_moderation_actions;
create trigger social_post_moderation_actions_immutable before update or delete on public.social_post_moderation_actions
for each row execute function public.guard_social_moderation_audit_cleanup();
revoke all on function public.guard_social_moderation_audit_cleanup() from public,anon,authenticated;
