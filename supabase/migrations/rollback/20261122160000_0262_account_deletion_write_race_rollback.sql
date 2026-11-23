-- Rollback for 0262. Drops the write guard and restores the 0073 create_social_comment
-- and create_social_quote bodies and the 0122 promote_wanted_to_saved_list body.
-- Cost: a write in flight can again land after its author's account is deleted, and
-- the deletion leaves that row behind. No data changes.
begin;

drop trigger social_posts_refuse_deleted_author on public.social_posts;
drop trigger social_comments_refuse_deleted_author on public.social_comments;
drop trigger social_quotes_refuse_deleted_author on public.social_quotes;
drop trigger social_video_uploads_refuse_deleted_author on public.social_video_uploads;
drop trigger saved_pubs_refuse_deleted_author on public.saved_pubs;
drop trigger saved_lists_refuse_deleted_author on public.saved_lists;
drop trigger saved_list_follows_refuse_deleted_author on public.saved_list_follows;
drop trigger check_ins_refuse_deleted_author on public.check_ins;
drop trigger wanteds_refuse_deleted_author on public.wanteds;

create or replace function public.create_social_comment(
  p_actor uuid,
  p_post_id uuid,
  p_author_handle text,
  p_body text,
  p_idempotency_key_hash text,
  p_payload_digest text
)
returns setof public.social_comments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.social_posts;
  v_row public.social_comments;
begin
  select * into v_post from public.social_posts where id = p_post_id for update;
  if v_post.id is null
    or not public.social_post_readable(v_post, p_actor)
    or public.social_interaction_blocked(p_actor, v_post.author_profile_id)
  then raise exception 'post not found'; end if;
  if v_post.comment_policy = 'locked'
    or (v_post.comment_policy = 'friends' and p_actor <> v_post.author_profile_id and not (
      exists(select 1 from public.follows where follower_id = p_actor and followee_id = v_post.author_profile_id)
      and exists(select 1 from public.follows where follower_id = v_post.author_profile_id and followee_id = p_actor)
    ))
  then raise exception 'comments not allowed'; end if;

  insert into public.social_comments(post_id, author_profile_id, author_handle, body, idempotency_key_hash, payload_digest)
  values (p_post_id, p_actor, p_author_handle, p_body, p_idempotency_key_hash, p_payload_digest)
  on conflict (author_profile_id, idempotency_key_hash) do nothing returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.social_comments where author_profile_id = p_actor and idempotency_key_hash = p_idempotency_key_hash;
    if v_row.payload_digest <> p_payload_digest then raise exception 'idempotency conflict'; end if;
  else
    insert into public.social_interaction_moderation_jobs(content_kind, content_id, moderation_claim)
    values ('comment', v_row.id, v_row.body);
  end if;
  return next v_row;
end;
$$;

create or replace function public.create_social_quote(
  p_actor uuid,
  p_post_id uuid,
  p_author_handle text,
  p_body text,
  p_visibility text,
  p_idempotency_key_hash text,
  p_payload_digest text
)
returns setof public.social_quotes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.social_posts;
  v_row public.social_quotes;
begin
  select * into v_post from public.social_posts where id = p_post_id for share;
  if v_post.id is null
    or not public.social_post_readable(v_post, p_actor)
    or public.social_interaction_blocked(p_actor, v_post.author_profile_id)
  then raise exception 'post not found'; end if;
  if p_visibility not in ('public', 'friends', 'private') then raise exception 'invalid quote'; end if;
  insert into public.social_quotes(source_post_id, author_profile_id, author_handle, body, visibility, idempotency_key_hash, payload_digest)
  values (p_post_id, p_actor, p_author_handle, p_body, p_visibility, p_idempotency_key_hash, p_payload_digest)
  on conflict (author_profile_id, idempotency_key_hash) do nothing returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.social_quotes where author_profile_id = p_actor and idempotency_key_hash = p_idempotency_key_hash;
    if v_row.payload_digest <> p_payload_digest then raise exception 'idempotency conflict'; end if;
  else
    insert into public.social_interaction_moderation_jobs(content_kind, content_id, moderation_claim)
    values ('quote', v_row.id, v_row.body);
  end if;
  return next v_row;
end;
$$;

create or replace function public.promote_wanted_to_saved_list(
  p_owner_actor text,
  p_profile_id uuid,
  p_wanted_id uuid,
  p_venue_id text,
  p_list_type text
)
returns table (
  outcome text,
  promoted_list_type text,
  promoted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wanted public.wanteds%rowtype;
  v_promoted_at timestamptz := now();
  v_inserted boolean;
begin
  select *
    into v_wanted
    from public.wanteds
   where id = p_wanted_id
     and owner_actor = p_owner_actor
   for update;

  if not found then
    return query select 'not_found'::text, null::text, null::timestamptz;
    return;
  end if;

  if p_owner_actor <> ('profile:' || p_profile_id::text)
     or v_wanted.status <> 'open'
     or v_wanted.venue_kind <> 'curated'
     or v_wanted.venue_id is distinct from p_venue_id then
    return query select 'not_promotable'::text, null::text, null::timestamptz;
    return;
  end if;

  if v_wanted.promoted_list_type is not null then
    if v_wanted.promoted_list_type = p_list_type then
      insert into public.saved_pubs (profile_id, venue_id, list_type, note)
      values (p_profile_id, p_venue_id, p_list_type, null)
      on conflict (profile_id, venue_id, list_type) do nothing;
      return query select
        'already_saved'::text,
        v_wanted.promoted_list_type,
        v_wanted.promoted_at;
    else
      return query select 'already_promoted'::text, null::text, null::timestamptz;
    end if;
    return;
  end if;

  insert into public.saved_pubs (profile_id, venue_id, list_type, note)
  values (p_profile_id, p_venue_id, p_list_type, null)
  on conflict (profile_id, venue_id, list_type) do nothing;
  v_inserted := found;

  update public.wanteds
     set promoted_list_type = p_list_type,
         promoted_at = v_promoted_at
   where id = p_wanted_id;

  if v_inserted then
    return query select 'saved'::text, p_list_type, v_promoted_at;
  else
    return query select 'already_saved'::text, p_list_type, v_promoted_at;
  end if;
end
$$;

drop function public._refuse_deleted_author_write();
drop function public._lock_live_author(uuid);

commit;
