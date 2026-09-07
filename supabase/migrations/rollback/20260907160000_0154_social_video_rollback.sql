-- Refuse rollback while video bytes or references remain. Remove them through the existing cleanup lifecycle first.
-- No video is silently relabelled as a JPEG and no storage object is deleted here.
do $$ begin
  if exists(select 1 from public.social_post_media where content_type='video/mp4')
    or exists(select 1 from public.social_post_media_uploads where content_type='video/mp4') then
    raise exception 'Remove video attachments and finish media cleanup before rollback';
  end if;
end; $$;
drop trigger social_video_tags on public.social_post_tag_proposals;
drop function public.refuse_social_video_tags();
drop trigger social_post_media_format on public.social_posts;
drop function public.bind_social_post_media_format();
drop trigger social_media_format on public.social_post_media;
drop function public.bind_social_media_format();
drop function public.reserve_social_post_video_upload(uuid,uuid,text,integer,integer,integer,double precision);
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
        case when new.photo_alt_text is not null then 'Photo: ' || new.photo_alt_text end)
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
alter table public.social_posts drop column photo_content_type;
alter table public.social_post_media drop constraint social_post_media_content_type_check;
alter table public.social_post_media drop column duration_seconds;
alter table public.social_post_media add constraint social_post_media_content_type_check check(content_type='image/jpeg');
alter table public.social_post_media_uploads drop constraint social_post_upload_content_type_check;
alter table public.social_post_media_uploads drop constraint social_post_media_upload_private_path_check;
alter table public.social_post_media_uploads drop column duration_seconds,drop column content_type;
alter table public.social_post_media_uploads add constraint social_post_media_upload_private_path_check check(
 object_key='social/' || media_id::text || '/' || generation::text || '/image.jpg');
alter table public.social_post_media drop constraint social_post_media_private_path_check;
alter table public.social_post_media add constraint social_post_media_private_path_check check(
 object_key='social/' || id::text || '/' || generation::text || '/image.jpg');

alter table public.social_post_media drop constraint social_post_media_width_check,drop constraint social_post_media_height_check;
alter table public.social_post_media add constraint social_post_media_width_check check(width between 1 and 1200),
 add constraint social_post_media_height_check check(height between 1 and 1200);
alter table public.social_post_media_uploads drop constraint social_post_media_uploads_width_check,drop constraint social_post_media_uploads_height_check;
alter table public.social_post_media_uploads add constraint social_post_media_uploads_width_check check(width between 1 and 1200),
 add constraint social_post_media_uploads_height_check check(height between 1 and 1200);

drop trigger social_post_moderation_actions_immutable on public.social_post_moderation_actions;
create trigger social_post_moderation_actions_immutable before update or delete on public.social_post_moderation_actions
for each row execute function public.reject_social_append_only_change();
drop function public.guard_social_moderation_audit_cleanup();
