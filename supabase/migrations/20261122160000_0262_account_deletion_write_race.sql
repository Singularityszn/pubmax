-- 0262: A write by an account that is being deleted, or is deleted, is refused (#3206).
--
-- 1. public._lock_live_author(profile) takes the author's auth.users row FOR KEY SHARE,
--    the auth-row-first order that 0245 and 0255 share. An auth.users DELETE takes that
--    row before its triggers run. A write that holds it first makes the deletion wait
--    until the write commits, so the deletion sees the new row. A write that comes
--    second waits for the deletion, finds no auth row, and is refused with SQLSTATE
--    P0262 and no row. A tombstoned profile is refused at once.
-- 2. KEY SHARE, not SHARE or UPDATE: it conflicts only with a DELETE or a key change of
--    the auth row. Two writes by one live person never wait for each other, and a
--    sign-in or token refresh (a non-key UPDATE of auth.users) never waits for a write.
--    It is the lock a foreign key to auth.users already takes.
-- 3. A live profile with no auth user (an unbound demo or legacy profile) has no
--    deletion to race, so it is not refused. A profile ID that names no profile is left
--    to the table's own foreign key.
-- 4. One BEFORE INSERT trigger on each guarded table calls the helper, so the Social RPCs
--    and the stores' direct inserts are all covered: social_posts, social_comments,
--    social_quotes, social_video_uploads, saved_pubs, saved_lists, saved_list_follows
--    (the follower and the list owner), check_ins and wanteds ('profile:<id>').
-- 5. create_social_comment, create_social_quote and promote_wanted_to_saved_list lock a
--    row that a deletion can also write (the author's own post, the Wanted) before they
--    insert. Each now calls the helper first, so it keeps the auth-row-first order and
--    cannot deadlock with a deletion. Their bodies are otherwise unchanged.
--
-- Rollback drops the triggers and helpers and restores the 0073 and 0122 bodies. A write
-- in flight can again land after a deletion. No data changes.
begin;

-- A row lock on auth.users needs UPDATE on it. Without that this migration stops here.
do $$
begin
  if not pg_catalog.has_any_column_privilege('auth.users','UPDATE') then
    raise exception '0262 needs UPDATE on auth.users to lock an author''s auth row';
  end if;
end;
$$;

create function public._lock_live_author(p_profile_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare
  v_user uuid;
  v_tombstoned_at timestamptz;
begin
  select p.user_id, p.tombstoned_at into v_user, v_tombstoned_at
    from public.profiles p where p.id = p_profile_id;
  if not found then return; end if;
  if v_tombstoned_at is null then
    if v_user is null then return; end if;
    perform 1 from auth.users u where u.id = v_user for key share;
    if found then return; end if;
  end if;
  raise exception using errcode = 'P0262', message = 'author_account_deleted';
end;
$$;

-- Each trigger argument names a column that holds a profile ID, or a 'profile:<id>' actor.
create function public._refuse_deleted_author_write()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  v_row jsonb := pg_catalog.to_jsonb(new);
  v_column text;
  v_value text;
begin
  foreach v_column in array tg_argv loop
    v_value := pg_catalog.regexp_replace(v_row ->> v_column, '^profile:', '');
    if v_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform public._lock_live_author(v_value::uuid);
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public._lock_live_author(uuid) from public, anon, authenticated, service_role;
revoke all on function public._refuse_deleted_author_write() from public, anon, authenticated, service_role;

create trigger social_posts_refuse_deleted_author before insert on public.social_posts
  for each row execute function public._refuse_deleted_author_write('author_profile_id');
create trigger social_comments_refuse_deleted_author before insert on public.social_comments
  for each row execute function public._refuse_deleted_author_write('author_profile_id');
create trigger social_quotes_refuse_deleted_author before insert on public.social_quotes
  for each row execute function public._refuse_deleted_author_write('author_profile_id');
create trigger social_video_uploads_refuse_deleted_author before insert on public.social_video_uploads
  for each row execute function public._refuse_deleted_author_write('owner_profile_id');
create trigger saved_pubs_refuse_deleted_author before insert on public.saved_pubs
  for each row execute function public._refuse_deleted_author_write('profile_id');
create trigger saved_lists_refuse_deleted_author before insert on public.saved_lists
  for each row execute function public._refuse_deleted_author_write('profile_id');
create trigger saved_list_follows_refuse_deleted_author before insert on public.saved_list_follows
  for each row execute function public._refuse_deleted_author_write('follower_profile_id', 'list_owner_profile_id');
create trigger check_ins_refuse_deleted_author before insert on public.check_ins
  for each row execute function public._refuse_deleted_author_write('author_id');
create trigger wanteds_refuse_deleted_author before insert on public.wanteds
  for each row execute function public._refuse_deleted_author_write('owner_actor');

-- The 0073 body. The author's auth row first, then the post row it locks.
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
  perform public._lock_live_author(p_actor);
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

-- The 0073 body. The author's auth row first, then the post row it locks.
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
  perform public._lock_live_author(p_actor);
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

-- The 0122 body. The owner's auth row first, then the Wanted row it locks.
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
  perform public._lock_live_author(p_profile_id);
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

commit;
