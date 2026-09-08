-- 0155: Apply before deploying gallery code. Service role only.
alter table public.social_post_media_uploads add column uploaded_at timestamptz;
alter table public.social_posts add column gallery_photos jsonb;
alter table public.social_post_moderation_jobs add column gallery_manifest_lease_token uuid;
alter table public.social_posts add constraint social_gallery_projection_array check (
  gallery_photos is null or (jsonb_typeof(gallery_photos)='array' and jsonb_array_length(gallery_photos)<=10)
);
alter table public.social_post_create_requests add column gallery_payload_digest text
  check(gallery_payload_digest is null or gallery_payload_digest ~ '^[0-9a-f]{64}$');

create table public.social_post_gallery (
  post_id uuid not null references public.social_posts(id) on delete cascade,
  media_id uuid not null references public.social_post_media(id) on delete restrict,
  position integer not null check(position between 1 and 10),
  alt_text text not null check(length(btrim(alt_text)) between 1 and 300),
  primary key(post_id,media_id),
  unique(media_id),
  unique(post_id,position) deferrable initially deferred
);
create table public.social_post_gallery_edit_requests (
  author_profile_id uuid not null references public.profiles(id) on delete cascade,
  idempotency_key text not null check(idempotency_key ~ '^[A-Za-z0-9._:-]{16,128}$'),
  request_digest text not null check(request_digest ~ '^[0-9a-f]{64}$'),
  payload_digest text not null check(payload_digest ~ '^[0-9a-f]{64}$'),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  to_mutation_version integer not null check(to_mutation_version>=0),
  created_at timestamptz not null default now(),
  primary key(author_profile_id,idempotency_key)
);
alter table public.social_post_gallery enable row level security;
alter table public.social_post_gallery_edit_requests enable row level security;
revoke all on public.social_post_gallery,public.social_post_gallery_edit_requests from public,anon,authenticated;
grant select,insert,update,delete on public.social_post_gallery,public.social_post_gallery_edit_requests to service_role;

create function public.social_gallery_manifest(p_gallery jsonb)
returns table(media_id uuid,alt_text text,"position" integer)
language plpgsql immutable set search_path=public as $$
declare v_item jsonb; v_position integer:=0; v_ids uuid[]:='{}'; v_id uuid;
begin
  if p_gallery is null or jsonb_typeof(p_gallery)<>'array' or jsonb_array_length(p_gallery)>10
    then raise exception 'invalid Social gallery'; end if;
  for v_item in select value from jsonb_array_elements(p_gallery) loop
    if jsonb_typeof(v_item)<>'object' or jsonb_typeof(v_item->'mediaId') is distinct from 'string'
      or jsonb_typeof(v_item->'altText') is distinct from 'string'
      or exists(select 1 from jsonb_object_keys(v_item) k where k not in ('mediaId','altText'))
      or length(btrim(v_item->>'altText')) not between 1 and 300
      then raise exception 'invalid Social gallery'; end if;
    v_id:=(v_item->>'mediaId')::uuid;
    if v_id=any(v_ids) then raise exception 'duplicate Social gallery media'; end if;
    v_ids:=array_append(v_ids,v_id); v_position:=v_position+1;
    media_id:=v_id; alt_text:=v_item->>'altText'; "position":=v_position; return next;
  end loop;
end; $$;

create function public.social_gallery_projection(p_post_id uuid)
returns jsonb language sql stable set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object('mediaId',g.media_id,'altText',g.alt_text) order by g.position),'[]'::jsonb)
  from public.social_post_gallery g where g.post_id=p_post_id;
$$;

create function public.guard_social_gallery_item()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='UPDATE' and (old.post_id<>new.post_id or old.media_id<>new.media_id)
    then raise exception 'Social gallery membership is immutable'; end if;
  if not exists(select 1 from public.social_posts p join public.social_post_media m
    on m.owner_profile_id=p.author_profile_id
    where p.id=new.post_id and p.status='visible' and m.id=new.media_id
      and m.attachment_state='active' and m.content_type='image/jpeg')
    or exists(select 1 from public.social_posts p where p.photo_media_id=new.media_id and p.id<>new.post_id)
    then raise exception 'invalid Social gallery owner'; end if;
  return new;
end; $$;
create trigger social_gallery_item_guard before insert or update on public.social_post_gallery
for each row execute function public.guard_social_gallery_item();

create function public.check_social_gallery_projection()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_post public.social_posts; v_projection jsonb;
begin
  if tg_table_name='social_posts' then v_id:=coalesce(new.id,old.id);
  else v_id:=coalesce(new.post_id,old.post_id); end if;
  select * into v_post from public.social_posts where id=v_id;
  if not found then return null; end if;
  v_projection:=public.social_gallery_projection(v_id);
  if exists(select 1 from (select position,row_number() over(order by position) expected
    from public.social_post_gallery where post_id=v_id) positions where position<>expected)
    then raise exception 'Social gallery positions must be contiguous'; end if;
  if (v_post.gallery_photos is null and v_projection<>'[]'::jsonb)
    or (v_post.gallery_photos is not null and (
      v_post.gallery_photos is distinct from v_projection
      or v_post.photo_media_id is distinct from (v_projection->0->>'mediaId')::uuid
      or v_post.photo_alt_text is distinct from (v_projection->0->>'altText')
    )) then raise exception 'Social gallery projection mismatch'; end if;
  return null;
end; $$;
create constraint trigger social_gallery_projection_consistent after insert or update or delete on public.social_post_gallery
deferrable initially deferred for each row execute function public.check_social_gallery_projection();
create constraint trigger social_gallery_post_consistent after insert or update on public.social_posts
deferrable initially deferred for each row execute function public.check_social_gallery_projection();

create or replace function public.claim_social_post_media_upload_cleanup(
  p_owner_profile_id uuid,p_media_id uuid,p_generation uuid
)
returns table(generation uuid,object_key text,cleanup_token uuid)
language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('social-media-upload:' || p_media_id::text,0));
  return query update public.social_post_media_uploads upload set
    state='cleanup',cleanup_token=gen_random_uuid(),cleanup_lease_until=now()+interval '5 minutes'
  where upload.media_id=p_media_id and upload.owner_profile_id=p_owner_profile_id
    and upload.generation=p_generation and upload.uploaded_at is null
    and (upload.state='staged' or (upload.state='cleanup' and upload.cleanup_lease_until<now()))
  returning upload.generation,upload.object_key,upload.cleanup_token;
end; $$;

create function public.mark_social_gallery_upload_ready(p_owner_profile_id uuid,p_media_id uuid,p_generation uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('social-media-upload:' || p_media_id::text,0));
  if exists(select 1 from public.social_post_media where id=p_media_id) then return false; end if;
  update public.social_post_media_uploads set uploaded_at=coalesce(uploaded_at,now())
  where media_id=p_media_id and owner_profile_id=p_owner_profile_id and generation=p_generation
    and state='staged' and content_type='image/jpeg' and created_at>now()-interval '24 hours';
  return found;
end; $$;

create function public.read_social_gallery_uploads(p_owner_profile_id uuid,p_media_ids uuid[])
returns table(media_id uuid,generation uuid,object_key text,sha256 text,width integer,height integer,byte_size integer,content_type text)
language plpgsql stable security definer set search_path=public as $$
begin
  if p_media_ids is null or cardinality(p_media_ids)>10 or array_position(p_media_ids,null) is not null
    or cardinality(p_media_ids)<>(select count(distinct x) from unnest(p_media_ids) x)
    then raise exception 'invalid Social gallery'; end if;
  return query select u.media_id,u.generation,u.object_key,u.sha256,u.width,u.height,u.byte_size,u.content_type
  from unnest(p_media_ids) with ordinality requested(id,position)
  join public.social_post_media_uploads u on u.media_id=requested.id
  where u.owner_profile_id=p_owner_profile_id and u.state='staged' and u.uploaded_at is not null
    and u.content_type='image/jpeg' and u.created_at>now()-interval '24 hours'
  order by requested.position;
end; $$;

create function public.lock_social_gallery_media(p_actor uuid,p_post_id uuid,p_gallery jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  for v_id in select m.media_id from public.social_gallery_manifest(p_gallery) m order by m.media_id loop
    perform pg_advisory_xact_lock(hashtextextended('social-media-upload:' || v_id::text,0));
    perform 1 from public.social_post_media_uploads where media_id=v_id for update;
    perform 1 from public.social_post_media where id=v_id for update;
    if not exists(select 1 from public.social_post_media_uploads u where u.media_id=v_id
      and u.owner_profile_id=p_actor and u.state='staged' and u.uploaded_at is not null
      and u.created_at>now()-interval '24 hours' and u.content_type='image/jpeg')
      and not exists(select 1 from public.social_post_media m join public.social_posts p
        on p.id=p_post_id and p.author_profile_id=p_actor
        where m.id=v_id and m.owner_profile_id=p_actor and m.attachment_state='active' and m.content_type='image/jpeg'
          and (p.photo_media_id=m.id or exists(select 1 from public.social_post_gallery g where g.post_id=p.id and g.media_id=m.id)))
      then raise exception 'invalid Social gallery reservation'; end if;
    if exists(select 1 from public.social_post_media where id=v_id)
      and not exists(select 1 from public.social_posts p where p.id=p_post_id and p.author_profile_id=p_actor
        and (p.photo_media_id=v_id or exists(select 1 from public.social_post_gallery g where g.post_id=p.id and g.media_id=v_id)))
      then raise exception 'Social gallery media already attached'; end if;
  end loop;
end; $$;

create function public.attach_social_gallery(p_actor uuid,p_post_id uuid,p_gallery jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_item record;
begin
  -- Caller holds the post, media, and reservation locks. Deferred uniqueness permits reordering.
  delete from public.social_post_gallery where post_id=p_post_id;
  for v_item in select * from public.social_gallery_manifest(p_gallery) loop
    if not exists(select 1 from public.social_post_media where id=v_item.media_id) then
      insert into public.social_post_media(id,generation,owner_profile_id,object_key,sha256,width,height,byte_size)
      select u.media_id,u.generation,u.owner_profile_id,u.object_key,u.sha256,u.width,u.height,u.byte_size
      from public.social_post_media_uploads u where u.media_id=v_item.media_id and u.owner_profile_id=p_actor
        and u.state='staged' and u.uploaded_at is not null and u.content_type='image/jpeg'
        and u.created_at>now()-interval '24 hours';
      if not found then raise exception 'invalid Social gallery reservation'; end if;
      delete from public.social_post_media_uploads where media_id=v_item.media_id;
    end if;
    insert into public.social_post_gallery(post_id,media_id,position,alt_text)
    values(p_post_id,v_item.media_id,v_item.position,v_item.alt_text);
  end loop;
end; $$;

create function public.detach_social_gallery_media(p_actor uuid,p_post_id uuid,p_media_ids uuid[])
returns void language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_retention timestamptz:=now()+interval '30 days';
begin
  for v_id in select distinct x from unnest(p_media_ids) x where x is not null order by x loop
    update public.social_post_media set attachment_state='detached',retention_expires_at=v_retention,
      cleanup_token=null,cleanup_lease_until=null,updated_at=now()
    where id=v_id and owner_profile_id=p_actor and attachment_state='active'
      and not exists(select 1 from public.social_post_gallery where media_id=v_id)
      and not exists(select 1 from public.social_posts where photo_media_id=v_id);
    if found then insert into public.social_post_media_lifecycle_events(media_id,post_id,actor_profile_id,action,retention_expires_at)
      values(v_id,p_post_id,p_actor,'detached',v_retention); end if;
  end loop;
end; $$;

create function public.validate_social_gallery_payload(p_payload jsonb,p_edit boolean)
returns void language plpgsql immutable set search_path=public as $$
begin
  if p_payload is null or jsonb_typeof(p_payload)<>'object'
    or exists(select 1 from jsonb_object_keys(p_payload) k where k not in
      ('kind','visibility','body','area','venueId','hashtags','commentPolicy','gallery','postId','expectedMutationVersion'))
    then raise exception 'invalid Social gallery payload'; end if;
  perform 1 from public.social_gallery_manifest(p_payload->'gallery');
  if not p_edit and (jsonb_array_length(p_payload->'gallery')=0 or p_payload ? 'postId' or p_payload ? 'expectedMutationVersion')
    then raise exception 'invalid Social gallery create'; end if;
  if p_edit and (jsonb_typeof(p_payload->'postId') is distinct from 'string'
    or jsonb_typeof(p_payload->'expectedMutationVersion') is distinct from 'number'
    or (p_payload->>'expectedMutationVersion') !~ '^[0-9]+$') then raise exception 'invalid Social gallery edit'; end if;
  if exists(select 1 from jsonb_each(p_payload) e where e.key in ('kind','visibility','body','commentPolicy')
    and jsonb_typeof(e.value)<>'string') then raise exception 'invalid Social post fields'; end if;
  if exists(select 1 from jsonb_each(p_payload) e where e.key in ('area','venueId')
    and jsonb_typeof(e.value) not in ('string','null')) then raise exception 'invalid Social post fields'; end if;
  if p_payload ? 'hashtags' then
    if jsonb_typeof(p_payload->'hashtags')<>'array' then raise exception 'invalid Social hashtags'; end if;
    if exists(select 1 from jsonb_array_elements(p_payload->'hashtags') t where jsonb_typeof(t)<>'string')
      then raise exception 'invalid Social hashtags'; end if;
  end if;
end; $$;

create function public.create_social_post_gallery_idempotent(p_actor uuid,p_payload jsonb,p_idempotency_key text,p_request_digest text)
returns setof public.social_posts language plpgsql security definer set search_path=public,extensions as $$
declare v_post public.social_posts; v_request public.social_post_create_requests;
  v_upload public.social_post_media_uploads; v_first record; v_handle text; v_payload_digest text;
begin
  perform public.validate_social_gallery_payload(p_payload,false);
  if p_actor is null or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9._:-]{16,128}$'
    or p_request_digest is null or p_request_digest !~ '^[0-9a-f]{64}$' then raise exception 'invalid idempotency request'; end if;
  v_payload_digest:=encode(digest(convert_to(p_payload::text,'utf8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text || ':' || p_idempotency_key,0));
  select * into v_request from public.social_post_create_requests where author_profile_id=p_actor and idempotency_key=p_idempotency_key;
  if found then
    if v_request.request_digest<>p_request_digest or v_request.gallery_payload_digest is distinct from v_payload_digest
      then raise exception 'idempotency conflict'; end if;
    return query select * from public.social_posts where id=v_request.post_id; return;
  end if;
  select handle into v_handle from public.profiles where id=p_actor;
  if v_handle is null then raise exception 'Social actor not found'; end if;
  perform public.lock_social_gallery_media(p_actor,null,p_payload->'gallery');
  select * into v_first from public.social_gallery_manifest(p_payload->'gallery') order by position limit 1;
  select * into strict v_upload from public.social_post_media_uploads where media_id=v_first.media_id;
  select * into v_post from public.create_social_post_idempotent(
    p_actor,v_handle,p_payload->>'kind',p_payload->>'visibility',p_payload->>'body',p_payload->>'area',p_payload->>'venueId',
    array(select jsonb_array_elements_text(coalesce(p_payload->'hashtags','[]'))),p_payload->>'commentPolicy',
    v_upload.media_id,v_upload.object_key,v_upload.sha256,v_upload.width,v_upload.height,v_upload.byte_size,
    v_first.alt_text,'{}'::text[],p_idempotency_key,p_request_digest);
  perform public.attach_social_gallery(p_actor,v_post.id,p_payload->'gallery');
  update public.social_posts set gallery_photos=public.social_gallery_projection(v_post.id) where id=v_post.id returning * into v_post;
  update public.social_post_create_requests set gallery_payload_digest=v_payload_digest
    where author_profile_id=p_actor and idempotency_key=p_idempotency_key;
  return next v_post;
end; $$;


create or replace function public.reserve_social_post_media_upload(
  p_owner_profile_id uuid,p_media_id uuid,p_sha256 text,p_width integer,p_height integer,p_byte_size integer
)
returns table(media_id uuid,generation uuid,object_key text)
language plpgsql security definer set search_path=public as $$
declare v_upload public.social_post_media_uploads; v_generation uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('social-media-upload:' || p_media_id::text,0));
  if exists(select 1 from public.social_post_media where id=p_media_id) then raise exception 'Social media already attached'; end if;
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
  elsif v_upload.created_at<=now()-interval '24 hours' then
    raise exception 'Social photo reservation expired';
  elsif v_upload.owner_profile_id<>p_owner_profile_id or v_upload.sha256<>p_sha256
    or v_upload.width<>p_width or v_upload.height<>p_height or v_upload.byte_size<>p_byte_size
  then raise exception 'invalid Social photo reservation';
  elsif v_upload.state='cleanup' then
    raise exception 'Social photo cleanup in progress';
  end if;
  return query select v_upload.media_id,v_upload.generation,v_upload.object_key;
end; $$;

create function public.edit_social_post_gallery_core(
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
  p_content_changed boolean,
  p_gallery jsonb
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
  v_old_media_ids uuid[];
  v_gallery_changed boolean;
  v_content_changed boolean;
begin
  select * into v_old from public.social_posts post
  where post.id=p_post_id and post.author_profile_id=p_author_profile_id
    and post.status='visible' and post.mutation_version=p_expected_mutation_version
  for update;
  if v_old.id is null then return; end if;
  if p_gallery is null and v_old.gallery_photos is not null and
    (v_old.photo_media_id is distinct from p_photo_media_id or v_old.photo_alt_text is distinct from p_photo_alt_text)
    then raise exception 'Use the gallery edit contract'; end if;
  v_gallery_changed:=p_gallery is not null and v_old.gallery_photos is distinct from p_gallery;
  v_content_changed:=p_content_changed or v_gallery_changed;
  select coalesce(array_agg(media_id),'{}'::uuid[]) into v_old_media_ids
    from public.social_post_gallery where post_id=v_old.id;
  v_old_media_ids:=array_append(v_old_media_ids,v_old.photo_media_id);
  if v_gallery_changed then v_fields:=array_append(v_fields,'gallery'); end if;
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
  v_moderation_changed := v_gallery_changed or v_old.kind is distinct from p_kind
    or v_old.body is distinct from p_body
    or v_old.hashtags is distinct from p_hashtags
    or v_old.photo_media_id is distinct from p_photo_media_id
    or v_old.photo_alt_text is distinct from p_photo_alt_text;
  if p_gallery is not null then perform public.attach_social_gallery(p_author_profile_id,v_old.id,p_gallery); end if;
  update public.social_posts post set
    kind=p_kind, visibility=p_visibility, body=p_body, area_slug=p_area_slug,
    venue_id=p_venue_id, hashtags=p_hashtags, comment_policy=p_comment_policy,
    photo_media_id=p_photo_media_id, photo_alt_text=p_photo_alt_text,
    gallery_photos=case when p_gallery is null then post.gallery_photos else public.social_gallery_projection(v_old.id) end,
    feature_status=case when p_kind='feature_request' then coalesce(post.feature_status,'submitted') else null end,
    feature_staff_response=case when p_kind='feature_request' then post.feature_staff_response else null end,
    revision=post.revision + case when v_content_changed then 1 else 0 end,
    mutation_version=post.mutation_version + 1,
    edited_at=case when v_content_changed then now() else post.edited_at end,
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
  end if;
  if p_gallery is not null then
    insert into public.social_post_tag_events(proposal_id,actor_profile_id,action)
      select id,p_author_profile_id,'cancel' from public.social_post_tag_proposals
      where post_id=v_new.id and state in ('proposed','approved');
    update public.social_post_tag_proposals set state='cancelled',decided_at=now()
      where post_id=v_new.id and state in ('proposed','approved');
  end if;
  perform public.detach_social_gallery_media(p_author_profile_id,v_new.id,v_old_media_ids);
  return next v_new;
end;
$$;

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
begin
  return query select * from public.edit_social_post_gallery_core(
    p_post_id,p_author_profile_id,p_expected_mutation_version,p_kind,p_visibility,p_body,p_area_slug,
    p_venue_id,p_hashtags,p_comment_policy,p_photo_media_id,p_photo_alt_text,p_content_changed,null);
end;
$$;

create or replace function public.social_post_digest(p_post public.social_posts)
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
  select encode(digest(convert_to((jsonb_build_object(
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
  ) || case when p_post.gallery_photos is null then '{}'::jsonb
    else jsonb_build_object('gallery',p_post.gallery_photos) end)::text, 'utf8'), 'sha256'), 'hex');
$$;

create function public.edit_social_post_gallery_idempotent(p_actor uuid,p_payload jsonb,p_idempotency_key text,p_request_digest text)
returns table(post jsonb,from_mutation_version integer,to_mutation_version integer) language plpgsql security definer set search_path=public,extensions as $$
declare v_old public.social_posts; v_post public.social_posts; v_request public.social_post_gallery_edit_requests;
  v_payload_digest text; v_first record; v_kind text; v_body text; v_hashtags text[];
begin
  perform public.validate_social_gallery_payload(p_payload,true);
  if p_actor is null or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9._:-]{16,128}$'
    or p_request_digest is null or p_request_digest !~ '^[0-9a-f]{64}$' then raise exception 'invalid idempotency request'; end if;
  v_payload_digest:=encode(digest(convert_to(p_payload::text,'utf8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text || ':gallery-edit:' || p_idempotency_key,0));
  select * into v_request from public.social_post_gallery_edit_requests
    where author_profile_id=p_actor and idempotency_key=p_idempotency_key;
  if found then
    if v_request.request_digest<>p_request_digest or v_request.payload_digest<>v_payload_digest
      then raise exception 'idempotency conflict'; end if;
    return query select to_jsonb(p),(p_payload->>'expectedMutationVersion')::integer,v_request.to_mutation_version
      from public.social_posts p where p.id=v_request.post_id; return;
  end if;
  select * into v_old from public.social_posts where id=(p_payload->>'postId')::uuid
    and author_profile_id=p_actor and status='visible'
    and mutation_version=(p_payload->>'expectedMutationVersion')::integer for update;
  if v_old.id is null then raise exception 'edit conflict'; end if;
  perform public.lock_social_gallery_media(p_actor,v_old.id,p_payload->'gallery');
  select * into v_first from public.social_gallery_manifest(p_payload->'gallery') order by position limit 1;
  v_kind:=coalesce(p_payload->>'kind',v_old.kind);
  v_body:=coalesce(p_payload->>'body',v_old.body);
  v_hashtags:=case when p_payload ? 'hashtags' then array(select jsonb_array_elements_text(p_payload->'hashtags')) else v_old.hashtags end;
  select * into v_post from public.edit_social_post_gallery_core(
    v_old.id,p_actor,v_old.mutation_version,v_kind,coalesce(p_payload->>'visibility',v_old.visibility),v_body,
    case when p_payload ? 'area' then p_payload->>'area' else v_old.area_slug end,
    case when p_payload ? 'venueId' then p_payload->>'venueId' else v_old.venue_id end,
    v_hashtags,coalesce(p_payload->>'commentPolicy',v_old.comment_policy),v_first.media_id,v_first.alt_text,
    v_kind is distinct from v_old.kind or v_body is distinct from v_old.body or v_hashtags is distinct from v_old.hashtags,
    p_payload->'gallery');
  if v_post.id is null then raise exception 'edit conflict'; end if;
  insert into public.social_post_gallery_edit_requests(author_profile_id,idempotency_key,request_digest,payload_digest,post_id,to_mutation_version)
    values(p_actor,p_idempotency_key,p_request_digest,v_payload_digest,v_post.id,v_post.mutation_version);
  return query select to_jsonb(v_post),v_old.mutation_version,v_post.mutation_version;
end; $$;

create function public.read_social_gallery_moderation_manifest(p_post_id uuid,p_revision integer,p_lease_token uuid)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_post public.social_posts; v_items jsonb;
begin
  select p.* into v_post from public.social_posts p join public.social_post_moderation_jobs j on j.post_id=p.id
    and j.revision=p.revision and j.media_id is not distinct from p.photo_media_id
    where p.id=p_post_id and p.revision=p_revision and p.status='visible' and p.moderation_state='pending'
      and j.state='processing' and j.lease_token=p_lease_token and j.lease_until>now() for update of j;
  if not found then return null; end if;
  if v_post.gallery_photos is null then return jsonb_build_object('gallery',false,'items','[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object('mediaId',g.media_id,'objectKey',m.object_key,
    'altText',g.alt_text,'position',g.position) order by g.position),'[]'::jsonb) into v_items
  from public.social_post_gallery g join public.social_post_media m on m.id=g.media_id
    and m.owner_profile_id=v_post.author_profile_id and m.attachment_state='active' and m.content_type='image/jpeg'
  where g.post_id=p_post_id;
  if jsonb_array_length(v_items)<>jsonb_array_length(v_post.gallery_photos)
    or public.social_gallery_projection(p_post_id) is distinct from v_post.gallery_photos
    then raise exception 'Social gallery moderation manifest is incomplete'; end if;
  update public.social_post_moderation_jobs set gallery_manifest_lease_token=p_lease_token
    where post_id=p_post_id and revision=p_revision and lease_token=p_lease_token
      and state='processing' and lease_until>now();
  if not found then return null; end if;
  return jsonb_build_object('gallery',jsonb_array_length(v_items)>0,'items',v_items);
end; $$;

create function public.social_post_current_media(p_post_id uuid)
returns table(media_id uuid) language sql stable security definer set search_path=public as $$
  select photo_media_id from public.social_posts where id=p_post_id and photo_media_id is not null
  union select g.media_id from public.social_post_gallery g where g.post_id=p_post_id;
$$;

create or replace function public.read_social_post_media(p_viewer uuid,p_media_id uuid)
returns table(object_key text) language sql stable security definer set search_path=public as $$
  select media.object_key from public.social_post_media media
  join public.social_posts post on post.photo_media_id=media.id
    or exists(select 1 from public.social_post_gallery g where g.post_id=post.id and g.media_id=media.id)
  where media.id=p_media_id and media.moderation_state='approved' and media.attachment_state='active'
    and post.status='visible' and post.moderation_state='approved' and (
      public.social_post_readable(post,p_viewer)
      or exists(select 1 from public.social_post_tag_proposals proposal
        where proposal.post_id=post.id and proposal.media_id=media.id
          and proposal.target_profile_id=p_viewer and proposal.state in ('proposed','approved'))
    ) and not public.social_interaction_blocked(p_viewer,post.author_profile_id);
$$;

create or replace function public.read_social_post_media_admin(p_staff_role_id uuid,p_media_id uuid)
returns table(object_key text) language plpgsql stable security definer set search_path=public as $$
declare v_staff public.private_social_staff_roles;
begin
  select * into v_staff from public.private_social_staff_roles
    where id=p_staff_role_id and active and revoked_at is null and role='moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  return query select media.object_key from public.social_post_media media
  join public.social_posts post on post.photo_media_id=media.id
    or exists(select 1 from public.social_post_gallery g where g.post_id=post.id and g.media_id=media.id)
  join public.social_post_moderation_jobs job on job.post_id=post.id and job.revision=post.revision
    and job.media_id is not distinct from post.photo_media_id and job.state='done'
  where media.id=p_media_id and media.attachment_state='active' and post.status='visible'
    and (post.moderation_state='needs_review' or exists(select 1 from public.social_post_media held
      where held.id in (select current_media.media_id from public.social_post_current_media(post.id) current_media) and held.moderation_state='needs_review'));
end; $$;

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
      and job.lease_token=p_lease_token and job.state='processing' and job.lease_until>now() for update;
    if v_job.post_id is null then return false; end if;
    select * into v_post from public.social_posts post where post.id=p_post_id and post.revision=p_revision
      and post.status='visible' and post.moderation_state='pending' and post.photo_media_id is not distinct from p_media_id for update;
    if v_post.id is null then return false; end if;
    if v_post.gallery_photos is not null then
      if jsonb_array_length(v_post.gallery_photos)>0
        and v_job.gallery_manifest_lease_token is distinct from p_lease_token then return false; end if;
      if public.social_gallery_projection(v_post.id) is distinct from v_post.gallery_photos
        or exists(select 1 from public.social_post_gallery g left join public.social_post_media m on m.id=g.media_id
          where g.post_id=v_post.id and (m.id is null or m.attachment_state<>'active' or m.owner_profile_id<>v_post.author_profile_id))
        then return false; end if;
      perform 1 from public.social_post_media where id in (select current_media.media_id from public.social_post_current_media(v_post.id) current_media) order by id for update;
    end if;
    if p_media_id is not null then
      select * into v_media from public.social_post_media where id=p_media_id and attachment_state='active' for update;
      if v_media.id is null then return false; end if;
    end if;
    update public.social_post_moderation_jobs set state='done',lease_until=null,lease_token=null,gallery_manifest_lease_token=null,last_error_code=null,updated_at=now()
    where post_id=v_job.post_id and revision=v_job.revision
      and media_id is not distinct from v_job.media_id and lease_token=p_lease_token and state='processing';
    if not found then return false; end if;
    update public.social_posts set moderation_state=p_decision,moderated_at=now(),updated_at=now() where id=p_post_id;
    update public.social_post_media set moderation_state=p_decision,updated_at=now()
      where id in (select current_media.media_id from public.social_post_current_media(p_post_id) current_media);
    return true;
  end if;
  if p_decision is not null then raise exception 'invalid moderation decision'; end if;
  update public.social_post_moderation_jobs set
    state=case when p_retry_at is null then 'error' else 'pending' end,
    next_attempt_at=coalesce(p_retry_at,next_attempt_at),lease_until=null,lease_token=null,gallery_manifest_lease_token=null,
    last_error_code=left(coalesce(p_error_code,'provider_error'),80),updated_at=now()
  where post_id=p_post_id and revision=p_revision and media_id is not distinct from p_media_id
    and lease_token=p_lease_token and state='processing';
  return found;
end;
$$;

create function public.moderate_social_post_gallery_admin(p_staff_role_id uuid,p_post_id uuid,p_media_id uuid,p_expected_revision integer,p_action text,p_reviewed_media_ids uuid[])
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
        where media.id in (select current_media.media_id from public.social_post_current_media(v_post.id) current_media) and media.moderation_state = 'needs_review'
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
  if p_action='approve' and coalesce(jsonb_array_length(v_post.gallery_photos),0)>0
    and p_reviewed_media_ids is distinct from array(
      select g.media_id from public.social_post_gallery g where g.post_id=v_post.id order by g.position
    ) then return false; end if;
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
    where id in (select current_media.media_id from public.social_post_current_media(p_post_id) current_media);
  end if;
  insert into public.social_post_moderation_actions(staff_role_id,post_id,media_id,action)
  values (v_staff.id,p_post_id,p_media_id,p_action);
  return true;
end;
$$;

create or replace function public.moderate_social_post_admin(p_staff_role_id uuid,p_post_id uuid,p_media_id uuid,p_expected_revision integer,p_action text)
returns boolean language sql security definer set search_path=public as $$
  select public.moderate_social_post_gallery_admin(
    p_staff_role_id,p_post_id,p_media_id,p_expected_revision,p_action,null
  );
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
  if v_post.gallery_photos is not null then raise exception 'Gallery moderation requires reviewed revision'; end if;
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
declare v_post public.social_posts; v_media_ids uuid[];
begin
  perform pg_advisory_xact_lock(hashtextextended(p_author_profile_id::text || ':remove:' || p_idempotency_key,0));
  if exists(select 1 from public.social_post_remove_requests where author_profile_id=p_author_profile_id and idempotency_key=p_idempotency_key) then
    if exists(select 1 from public.social_post_remove_requests where author_profile_id=p_author_profile_id and idempotency_key=p_idempotency_key and post_id=p_post_id) then return true; end if;
    raise exception 'idempotency conflict';
  end if;
  select * into v_post from public.social_posts where id=p_post_id and author_profile_id=p_author_profile_id
    and status in ('visible','hidden') and mutation_version=p_expected_mutation_version for update;
  if v_post.id is null then return false; end if;
  select array_agg(media_id) into v_media_ids from public.social_post_current_media(v_post.id);
  delete from public.social_post_gallery where post_id=v_post.id;
  insert into public.social_post_tag_events(proposal_id,actor_profile_id,action)
    select id,p_author_profile_id,'cancel' from public.social_post_tag_proposals where post_id=p_post_id and state in ('proposed','approved');
  update public.social_post_tag_proposals set state='cancelled',decided_at=now() where post_id=p_post_id and state in ('proposed','approved');
  update public.social_posts set status='removed',photo_media_id=null,photo_alt_text=null,
    gallery_photos=case when gallery_photos is null then null else '[]'::jsonb end,mutation_version=mutation_version+1,edited_at=now(),updated_at=now() where id=p_post_id;
  delete from public.social_post_moderation_jobs where post_id=p_post_id;
  perform public.detach_social_gallery_media(p_author_profile_id,p_post_id,v_media_ids);
  insert into public.social_post_edit_audit(post_id,actor_profile_id,from_mutation_version,to_mutation_version,changed_fields,previous_digest,next_digest)
    select p_post_id,p_author_profile_id,v_post.mutation_version,v_post.mutation_version+1,
      array['status'] || case when v_post.photo_media_id is null then '{}'::text[] else array['photo','photoAltText'] end
      || case when v_post.gallery_photos is null then '{}'::text[] else array['gallery'] end,
      public.social_post_digest(v_post),public.social_post_digest(post)
    from public.social_posts post where id=p_post_id;
  insert into public.social_post_remove_requests values(p_author_profile_id,p_idempotency_key,p_post_id,now());
  return true;
end; $$;

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
        case when new.gallery_photos is not null then (select string_agg('Photo: ' || (x->>'altText'), E'\n' order by ord) from jsonb_array_elements(new.gallery_photos) with ordinality items(x,ord))
          when new.photo_alt_text is not null then (case when new.photo_content_type='video/mp4' then 'Video: ' else 'Photo: ' end) || new.photo_alt_text end)
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
      gallery_manifest_lease_token = null,
      last_error_code = null,
      updated_at = now();
  end if;
  return new;
end;
$$;

-- No client role can execute lookup, mutation, or internal gallery helpers.
revoke all on function public.social_gallery_manifest(jsonb) from public,anon,authenticated;
grant execute on function public.social_gallery_manifest(jsonb) to service_role;
revoke all on function public.social_gallery_projection(uuid) from public,anon,authenticated;
grant execute on function public.social_gallery_projection(uuid) to service_role;
revoke all on function public.guard_social_gallery_item() from public,anon,authenticated;
grant execute on function public.guard_social_gallery_item() to service_role;
revoke all on function public.check_social_gallery_projection() from public,anon,authenticated;
grant execute on function public.check_social_gallery_projection() to service_role;
revoke all on function public.mark_social_gallery_upload_ready(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.mark_social_gallery_upload_ready(uuid,uuid,uuid) to service_role;
revoke all on function public.read_social_gallery_uploads(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.read_social_gallery_uploads(uuid,uuid[]) to service_role;
revoke all on function public.lock_social_gallery_media(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.lock_social_gallery_media(uuid,uuid,jsonb) to service_role;
revoke all on function public.attach_social_gallery(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.attach_social_gallery(uuid,uuid,jsonb) to service_role;
revoke all on function public.detach_social_gallery_media(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.detach_social_gallery_media(uuid,uuid,uuid[]) to service_role;
revoke all on function public.validate_social_gallery_payload(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.validate_social_gallery_payload(jsonb,boolean) to service_role;
revoke all on function public.create_social_post_gallery_idempotent(uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.create_social_post_gallery_idempotent(uuid,jsonb,text,text) to service_role;
revoke all on function public.reserve_social_post_media_upload(uuid,uuid,text,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.reserve_social_post_media_upload(uuid,uuid,text,integer,integer,integer) to service_role;
revoke all on function public.edit_social_post_gallery_core(uuid,uuid,integer,text,text,text,text,text,text[],text,uuid,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.edit_social_post_gallery_core(uuid,uuid,integer,text,text,text,text,text,text[],text,uuid,text,boolean,jsonb) to service_role;
revoke all on function public.edit_social_post(uuid,uuid,integer,text,text,text,text,text,text[],text,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.edit_social_post(uuid,uuid,integer,text,text,text,text,text,text[],text,uuid,text,boolean) to service_role;
revoke all on function public.social_post_digest(public.social_posts) from public,anon,authenticated;
grant execute on function public.social_post_digest(public.social_posts) to service_role;
revoke all on function public.edit_social_post_gallery_idempotent(uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.edit_social_post_gallery_idempotent(uuid,jsonb,text,text) to service_role;
revoke all on function public.read_social_gallery_moderation_manifest(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.read_social_gallery_moderation_manifest(uuid,integer,uuid) to service_role;
revoke all on function public.social_post_current_media(uuid) from public,anon,authenticated;
grant execute on function public.social_post_current_media(uuid) to service_role;
revoke all on function public.read_social_post_media(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_social_post_media(uuid,uuid) to service_role;
revoke all on function public.read_social_post_media_admin(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_social_post_media_admin(uuid,uuid) to service_role;
revoke all on function public.complete_social_post_moderation_job(uuid,integer,uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.complete_social_post_moderation_job(uuid,integer,uuid,uuid,text,text,timestamptz) to service_role;
revoke all on function public.moderate_social_post_gallery_admin(uuid,uuid,uuid,integer,text,uuid[]) from public,anon,authenticated;
grant execute on function public.moderate_social_post_gallery_admin(uuid,uuid,uuid,integer,text,uuid[]) to service_role;
revoke all on function public.moderate_social_post_admin(uuid,uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.moderate_social_post_admin(uuid,uuid,uuid,integer,text) to service_role;
revoke all on function public.moderate_social_post(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.moderate_social_post(uuid,uuid,uuid,text) to service_role;
revoke all on function public.remove_social_post_idempotent(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.remove_social_post_idempotent(uuid,uuid,integer,text) to service_role;
revoke all on function public.queue_social_post_moderation() from public,anon,authenticated;

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
  if exists(select 1 from public.social_post_gallery g where g.media_id=new.photo_media_id and g.post_id<>new.id)
    then raise exception 'Social gallery media belongs to another post'; end if;
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
        where media.id in (select current_media.media_id from public.social_post_current_media(post.id) current_media) and media.moderation_state = 'needs_review'
      )))
  order by post.created_at, post.id
  limit p_limit;
end;
$$;
revoke all on function public.guard_social_post_photo_owner(),public.read_social_post_moderation_queue_admin(uuid,integer) from public,anon,authenticated;
grant execute on function public.read_social_post_moderation_queue_admin(uuid,integer) to service_role;
