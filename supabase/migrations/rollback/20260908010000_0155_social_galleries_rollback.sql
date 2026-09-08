-- 0155 rollback refuses live gallery associations. Remove galleries through the normal lifecycle first.
-- Empty-gallery markers and gallery edit replay receipts are discarded; media lifecycle audit remains.
do $$ begin
  if exists(select 1 from public.social_post_gallery) then
    raise exception 'Remove galleries before rollback';
  end if;
end; $$;
drop trigger social_gallery_item_guard on public.social_post_gallery;
drop trigger social_gallery_projection_consistent on public.social_post_gallery;
drop trigger social_gallery_post_consistent on public.social_posts;

create or replace function public.claim_social_post_media_upload_cleanup(
  p_owner_profile_id uuid,p_media_id uuid,p_generation uuid
)
returns table(generation uuid,object_key text,cleanup_token uuid)
language plpgsql security definer set search_path=public as $$
begin
  return query update public.social_post_media_uploads upload set
    state='cleanup',cleanup_token=gen_random_uuid(),cleanup_lease_until=now()+interval '5 minutes'
  where upload.media_id=p_media_id and upload.owner_profile_id=p_owner_profile_id
    and upload.generation=p_generation
    and (upload.state='staged' or (upload.state='cleanup' and upload.cleanup_lease_until<now()))
  returning upload.generation,upload.object_key,upload.cleanup_token;
end; $$;

create or replace function public.reserve_social_post_media_upload(
  p_owner_profile_id uuid,p_media_id uuid,p_sha256 text,p_width integer,p_height integer,p_byte_size integer
)
returns table(media_id uuid,generation uuid,object_key text)
language plpgsql security definer set search_path=public as $$
declare v_upload public.social_post_media_uploads; v_generation uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('social-media-upload:' || p_media_id::text,0));
  select * into v_upload from public.social_post_media_uploads upload where upload.media_id=p_media_id for update;
  if v_upload.media_id is null then
    v_generation := gen_random_uuid();
    insert into public.social_post_media_uploads(
      media_id,generation,owner_profile_id,object_key,sha256,width,height,byte_size
    ) values (
      p_media_id,v_generation,p_owner_profile_id,
      'social/' || p_media_id::text || '/' || v_generation::text || '/image.jpg',
      p_sha256,p_width,p_height,p_byte_size
    ) returning * into v_upload;
  elsif v_upload.owner_profile_id<>p_owner_profile_id or v_upload.sha256<>p_sha256
    or v_upload.width<>p_width or v_upload.height<>p_height or v_upload.byte_size<>p_byte_size
  then raise exception 'invalid Social photo reservation';
  elsif v_upload.state='cleanup' then
    raise exception 'Social photo cleanup in progress';
  end if;
  return query select v_upload.media_id,v_upload.generation,v_upload.object_key;
end; $$;

create or replace function public.edit_social_post(
  p_post_id uuid,
  p_author_profile_id uuid,
  p_expected_mutation_version integer,
  p_kind text,
  p_visibility text,
  p_body text,
  p_area_slug text,
  p_venue_id text,
  p_hashtags text[],
  p_comment_policy text,
  p_photo_media_id uuid,
  p_photo_alt_text text,
  p_content_changed boolean
)
returns setof public.social_posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.social_posts;
  v_new public.social_posts;
  v_fields text[] := '{}';
  v_moderation_changed boolean;
  v_retention_expires_at timestamptz;
begin
  select * into v_old from public.social_posts post
  where post.id=p_post_id and post.author_profile_id=p_author_profile_id
    and post.status='visible' and post.mutation_version=p_expected_mutation_version
  for update;
  if v_old.id is null then return; end if;
  if v_old.kind is distinct from p_kind then v_fields := array_append(v_fields,'kind'); end if;
  if v_old.visibility is distinct from p_visibility then v_fields := array_append(v_fields,'visibility'); end if;
  if v_old.body is distinct from p_body then v_fields := array_append(v_fields,'body'); end if;
  if v_old.area_slug is distinct from p_area_slug then v_fields := array_append(v_fields,'area'); end if;
  if v_old.venue_id is distinct from p_venue_id then v_fields := array_append(v_fields,'venue'); end if;
  if v_old.hashtags is distinct from p_hashtags then v_fields := array_append(v_fields,'hashtags'); end if;
  if v_old.comment_policy is distinct from p_comment_policy then v_fields := array_append(v_fields,'commentPolicy'); end if;
  if v_old.photo_media_id is distinct from p_photo_media_id then v_fields := array_append(v_fields,'photo'); end if;
  if v_old.photo_alt_text is distinct from p_photo_alt_text then v_fields := array_append(v_fields,'photoAltText'); end if;
  if cardinality(v_fields)=0 then return next v_old; return; end if;
  v_moderation_changed := v_old.kind is distinct from p_kind
    or v_old.body is distinct from p_body
    or v_old.hashtags is distinct from p_hashtags
    or v_old.photo_media_id is distinct from p_photo_media_id
    or v_old.photo_alt_text is distinct from p_photo_alt_text;
  update public.social_posts post set
    kind=p_kind, visibility=p_visibility, body=p_body, area_slug=p_area_slug,
    venue_id=p_venue_id, hashtags=p_hashtags, comment_policy=p_comment_policy,
    photo_media_id=p_photo_media_id, photo_alt_text=p_photo_alt_text,
    feature_status=case when p_kind='feature_request' then coalesce(post.feature_status,'submitted') else null end,
    feature_staff_response=case when p_kind='feature_request' then post.feature_staff_response else null end,
    revision=post.revision + case when p_content_changed then 1 else 0 end,
    mutation_version=post.mutation_version + 1,
    edited_at=case when p_content_changed then now() else post.edited_at end,
    moderation_state=case when v_moderation_changed then 'pending' else post.moderation_state end,
    moderated_at=case when v_moderation_changed then null else post.moderated_at end,
    updated_at=now()
  where post.id=v_old.id returning * into v_new;
  insert into public.social_post_edit_audit(
    post_id,actor_profile_id,from_mutation_version,to_mutation_version,changed_fields,previous_digest,next_digest
  ) values (
    v_new.id,p_author_profile_id,v_old.mutation_version,v_new.mutation_version,v_fields,
    public.social_post_digest(v_old),public.social_post_digest(v_new)
  );
  if v_old.visibility is distinct from v_new.visibility
    and v_old.photo_media_id is not distinct from v_new.photo_media_id
  then
    insert into public.social_post_tag_events(proposal_id,actor_profile_id,action)
    select id,p_author_profile_id,'audience_change' from public.social_post_tag_proposals
    where post_id=v_new.id and media_id=v_new.photo_media_id and state='approved';
    update public.social_post_tag_proposals set state='proposed',decided_at=null,
      audience_visibility=null,audience_revision=null,audience_shown_at=null
    where post_id=v_new.id and media_id=v_new.photo_media_id and state='approved';
  end if;
  if v_old.photo_media_id is distinct from v_new.photo_media_id then
    insert into public.social_post_tag_events(proposal_id,actor_profile_id,action)
    select id,p_author_profile_id,'cancel' from public.social_post_tag_proposals
    where post_id=v_new.id and media_id=v_old.photo_media_id and state in ('proposed','approved');
    update public.social_post_tag_proposals set state='cancelled',decided_at=now()
    where post_id=v_new.id and media_id=v_old.photo_media_id and state in ('proposed','approved');
    v_retention_expires_at := now()+interval '30 days';
    update public.social_post_media set attachment_state='detached',retention_expires_at=v_retention_expires_at,
      cleanup_token=null,cleanup_lease_until=null,updated_at=now()
    where id=v_old.photo_media_id;
    if v_old.photo_media_id is not null then
      insert into public.social_post_media_lifecycle_events(
        media_id,post_id,actor_profile_id,action,retention_expires_at
      ) values (v_old.photo_media_id,v_new.id,p_author_profile_id,'detached',v_retention_expires_at);
    end if;
  end if;
  return next v_new;
end;
$$;

create or replace function public.social_post_digest(p_post public.social_posts)
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
  select encode(digest(convert_to(jsonb_build_object(
    'kind', p_post.kind,
    'status', p_post.status,
    'visibility', p_post.visibility,
    'body', p_post.body,
    'area', p_post.area_slug,
    'venue', p_post.venue_id,
    'hashtags', p_post.hashtags,
    'commentPolicy', p_post.comment_policy,
    'photoMediaId', p_post.photo_media_id,
    'photoAltText', p_post.photo_alt_text
  )::text, 'utf8'), 'sha256'), 'hex');
$$;

create or replace function public.complete_social_post_moderation_job(
  p_post_id uuid,
  p_revision integer,
  p_media_id uuid,
  p_lease_token uuid,
  p_decision text default null,
  p_error_code text default null,
  p_retry_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_job public.social_post_moderation_jobs; v_post public.social_posts; v_media public.social_post_media;
begin
  if p_decision in ('approved','needs_review') then
    select * into v_job from public.social_post_moderation_jobs job where job.post_id=p_post_id
      and job.revision=p_revision and job.media_id is not distinct from p_media_id
      and job.lease_token=p_lease_token and job.state='processing' for update;
    if v_job.post_id is null then return false; end if;
    select * into v_post from public.social_posts post where post.id=p_post_id and post.revision=p_revision
      and post.moderation_state='pending' and post.photo_media_id is not distinct from p_media_id for update;
    if v_post.id is null then return false; end if;
    if p_media_id is not null then
      select * into v_media from public.social_post_media where id=p_media_id and attachment_state='active' for update;
      if v_media.id is null then return false; end if;
    end if;
    update public.social_post_moderation_jobs set state='done',lease_until=null,lease_token=null,last_error_code=null,updated_at=now()
    where post_id=v_job.post_id and revision=v_job.revision
      and media_id is not distinct from v_job.media_id and lease_token=p_lease_token and state='processing';
    if not found then return false; end if;
    update public.social_posts set moderation_state=p_decision,moderated_at=now(),updated_at=now() where id=p_post_id;
    if p_media_id is not null then update public.social_post_media set moderation_state=p_decision,updated_at=now() where id=p_media_id; end if;
    return true;
  end if;
  if p_decision is not null then raise exception 'invalid moderation decision'; end if;
  update public.social_post_moderation_jobs set
    state=case when p_retry_at is null then 'error' else 'pending' end,
    next_attempt_at=coalesce(p_retry_at,next_attempt_at),lease_until=null,lease_token=null,
    last_error_code=left(coalesce(p_error_code,'provider_error'),80),updated_at=now()
  where post_id=p_post_id and revision=p_revision and media_id is not distinct from p_media_id
    and lease_token=p_lease_token and state='processing';
  return found;
end;
$$;

create or replace function public.moderate_social_post_admin(p_staff_role_id uuid,p_post_id uuid,p_media_id uuid,p_expected_revision integer,p_action text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_staff public.private_social_staff_roles; v_post public.social_posts;
begin
  select * into v_staff from public.private_social_staff_roles
  where id = p_staff_role_id and active and revoked_at is null and role = 'moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  if p_action not in ('approve','hide') then raise exception 'invalid moderation action'; end if;
  select * into v_post from public.social_posts where id = p_post_id for update;
  if v_post.id is null or p_expected_revision is null
    or v_post.revision <> p_expected_revision
    or v_post.photo_media_id is distinct from p_media_id
    or v_post.status <> 'visible' or not (
      v_post.moderation_state = 'needs_review'
      or (v_post.moderation_state = 'approved' and p_media_id is not null and exists (
        select 1 from public.social_post_media media
        where media.id = p_media_id and media.moderation_state = 'needs_review'
      ))
    )
    or not exists (
      select 1 from public.social_post_moderation_jobs job
      where job.post_id = p_post_id
        and job.revision = v_post.revision
        and job.media_id is not distinct from p_media_id
        and job.state = 'done'
    )
    then return false; end if;
  update public.social_posts set
    moderation_state = case
      when p_action = 'approve' and moderation_state = 'needs_review' then 'approved'
      when p_action = 'hide' then 'needs_review'
      else moderation_state
    end,
    status = case when p_action = 'hide' then 'hidden' else status end,
    moderated_at = now(), updated_at = now()
  where id = v_post.id;
  if p_media_id is not null then
    update public.social_post_media set
      moderation_state = case when p_action = 'approve' then 'approved' else 'needs_review' end,
      updated_at = now()
    where id = p_media_id;
  end if;
  insert into public.social_post_moderation_actions(staff_role_id,post_id,media_id,action)
  values (v_staff.id,p_post_id,p_media_id,p_action);
  return true;
end;
$$;

create or replace function public.moderate_social_post(p_actor uuid,p_post_id uuid,p_media_id uuid,p_action text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_staff public.private_social_staff_roles; v_post public.social_posts;
begin
  select * into v_staff from public.private_social_staff_roles
  where profile_id=p_actor and active and revoked_at is null and role='moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  if p_action not in ('approve','hide') then raise exception 'invalid moderation action'; end if;
  select * into v_post from public.social_posts where id=p_post_id for update;
  if v_post.id is null or v_post.photo_media_id is distinct from p_media_id
    or v_post.moderation_state<>'needs_review' then raise exception 'held post not found'; end if;
  update public.social_posts set moderation_state=case when p_action='approve' then 'approved' else 'needs_review' end,
    status=case when p_action='hide' then 'hidden' else status end,moderated_at=now(),updated_at=now()
  where id=v_post.id;
  if p_media_id is not null then update public.social_post_media set
    moderation_state=case when p_action='approve' then 'approved' else 'needs_review' end,updated_at=now()
    where id=p_media_id; end if;
  insert into public.social_post_moderation_actions(staff_role_id,post_id,media_id,action)
  values (v_staff.id,p_post_id,p_media_id,p_action);
  return true;
end;
$$;

create or replace function public.remove_social_post_idempotent(p_post_id uuid,p_author_profile_id uuid,p_expected_mutation_version integer,p_idempotency_key text)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_post public.social_posts; v_retention_expires_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_author_profile_id::text || ':remove:' || p_idempotency_key,0));
  if exists(select 1 from public.social_post_remove_requests where author_profile_id=p_author_profile_id and idempotency_key=p_idempotency_key) then
    if exists(select 1 from public.social_post_remove_requests where author_profile_id=p_author_profile_id and idempotency_key=p_idempotency_key and post_id=p_post_id) then return true; end if;
    raise exception 'idempotency conflict';
  end if;
  select * into v_post from public.social_posts where id=p_post_id and author_profile_id=p_author_profile_id
    and status='visible' and mutation_version=p_expected_mutation_version for update;
  if v_post.id is null then return false; end if;
  insert into public.social_post_tag_events(proposal_id,actor_profile_id,action)
    select id,p_author_profile_id,'cancel' from public.social_post_tag_proposals where post_id=p_post_id and state in ('proposed','approved');
  update public.social_post_tag_proposals set state='cancelled',decided_at=now() where post_id=p_post_id and state in ('proposed','approved');
  update public.social_posts set status='removed',photo_media_id=null,photo_alt_text=null,mutation_version=mutation_version+1,edited_at=now(),updated_at=now() where id=p_post_id;
  delete from public.social_post_moderation_jobs where post_id=p_post_id;
  v_retention_expires_at := now()+interval '30 days';
  update public.social_post_media set attachment_state='detached',retention_expires_at=v_retention_expires_at,
    cleanup_token=null,cleanup_lease_until=null,updated_at=now() where id=v_post.photo_media_id;
  if v_post.photo_media_id is not null then
    insert into public.social_post_media_lifecycle_events(
      media_id,post_id,actor_profile_id,action,retention_expires_at
    ) values (v_post.photo_media_id,p_post_id,p_author_profile_id,'detached',v_retention_expires_at);
  end if;
  insert into public.social_post_edit_audit(post_id,actor_profile_id,from_mutation_version,to_mutation_version,changed_fields,previous_digest,next_digest)
    select p_post_id,p_author_profile_id,v_post.mutation_version,v_post.mutation_version+1,
      array['status'] || case when v_post.photo_media_id is null then '{}'::text[] else array['photo','photoAltText'] end,
      public.social_post_digest(v_post),public.social_post_digest(post)
    from public.social_posts post where id=p_post_id;
  insert into public.social_post_remove_requests values(p_author_profile_id,p_idempotency_key,p_post_id,now());
  return true;
end; $$;

create or replace function public.read_social_post_media(p_viewer uuid,p_media_id uuid)
returns table(object_key text)
language sql
stable
security definer
set search_path = public
as $$
  select media.object_key from public.social_post_media media
  join public.social_posts post on post.photo_media_id=media.id
  where media.id=p_media_id and media.moderation_state='approved' and media.attachment_state='active'
    and post.status='visible' and post.moderation_state='approved' and (
      public.social_post_readable(post,p_viewer)
      or exists (select 1 from public.social_post_tag_proposals proposal
        where proposal.post_id=post.id and proposal.media_id=media.id
          and proposal.target_profile_id=p_viewer and proposal.state in ('proposed','approved'))
    )
    and not public.social_interaction_blocked(p_viewer,post.author_profile_id);
$$;

create or replace function public.read_social_post_media_admin(p_staff_role_id uuid,p_media_id uuid)
returns table(object_key text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_staff public.private_social_staff_roles;
begin
  select * into v_staff from public.private_social_staff_roles
  where id = p_staff_role_id and active and revoked_at is null and role = 'moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  return query select media.object_key
  from public.social_post_media media
  join public.social_posts post on post.photo_media_id = media.id
  join public.social_post_moderation_jobs job on job.post_id = post.id
    and job.revision = post.revision
    and job.media_id is not distinct from post.photo_media_id
    and job.state = 'done'
  where media.id = p_media_id
    and media.attachment_state = 'active'
    and post.status = 'visible'
    and (post.moderation_state = 'needs_review' or media.moderation_state = 'needs_review');
end;
$$;

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
create or replace function public.guard_social_post_photo_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.photo_media_id is not null and not exists (
    select 1 from public.social_post_media media
    where media.id = new.photo_media_id
      and media.owner_profile_id = new.author_profile_id
      and media.attachment_state = 'active'
  ) then
    raise exception 'invalid Social photo';
  end if;
  return new;
end;
$$;
create or replace function public.read_social_post_moderation_queue_admin(p_staff_role_id uuid,p_limit integer default 20)
returns table(staff_display_name text,post_id uuid,media_id uuid,moderation_claim text,created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_staff public.private_social_staff_roles;
begin
  if p_limit < 1 or p_limit > 50 then raise exception 'invalid moderation queue size'; end if;
  select * into v_staff from public.private_social_staff_roles
  where id = p_staff_role_id and active and revoked_at is null and role = 'moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  return query select v_staff.display_name,post.id,post.photo_media_id,job.moderation_claim,post.created_at
  from public.social_posts post
  join public.social_post_moderation_jobs job on job.post_id = post.id
    and job.revision = post.revision
    and job.media_id is not distinct from post.photo_media_id
    and job.state = 'done'
  where post.status = 'visible'
    and (post.moderation_state = 'needs_review'
      or (post.moderation_state = 'approved' and exists (
        select 1 from public.social_post_media media
        where media.id = post.photo_media_id and media.moderation_state = 'needs_review'
      )))
  order by post.created_at, post.id
  limit p_limit;
end;
$$;
drop function public.moderate_social_post_gallery_admin(uuid,uuid,uuid,integer,text,uuid[]);
drop function public.social_post_current_media(uuid);
drop function public.read_social_gallery_moderation_manifest(uuid,integer,uuid);
drop function public.edit_social_post_gallery_idempotent(uuid,jsonb,text,text);
drop function public.edit_social_post_gallery_core(uuid,uuid,integer,text,text,text,text,text,text[],text,uuid,text,boolean,jsonb);
drop function public.create_social_post_gallery_idempotent(uuid,jsonb,text,text);
drop function public.validate_social_gallery_payload(jsonb,boolean);
drop function public.detach_social_gallery_media(uuid,uuid,uuid[]);
drop function public.attach_social_gallery(uuid,uuid,jsonb);
drop function public.lock_social_gallery_media(uuid,uuid,jsonb);
drop function public.read_social_gallery_uploads(uuid,uuid[]);
drop function public.mark_social_gallery_upload_ready(uuid,uuid,uuid);
drop function public.check_social_gallery_projection();
drop function public.guard_social_gallery_item();
drop function public.social_gallery_projection(uuid);
drop function public.social_gallery_manifest(jsonb);
drop table public.social_post_gallery_edit_requests;
drop table public.social_post_gallery;
alter table public.social_post_create_requests drop column gallery_payload_digest;
alter table public.social_posts drop column gallery_photos;
alter table public.social_post_moderation_jobs drop column gallery_manifest_lease_token;
alter table public.social_post_media_uploads drop column uploaded_at;
