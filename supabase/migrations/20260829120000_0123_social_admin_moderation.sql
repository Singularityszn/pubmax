-- Let the existing admin console consume Social's held-post queue.
-- Service-role execute is safe only behind the application admin gate.

create function public.read_social_post_moderation_queue_admin(p_limit integer default 20)
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
  where active and revoked_at is null and role = 'moderator'
  order by created_at, id limit 1;
  if v_staff.id is null then raise exception 'staff required'; end if;
  return query select v_staff.display_name,post.id,post.photo_media_id,job.moderation_claim,post.created_at
  from public.social_posts post
  join public.social_post_moderation_jobs job on job.post_id = post.id
  where post.status = 'visible'
    and (post.moderation_state = 'needs_review'
      or exists (
        select 1 from public.social_post_media media
        where media.id = post.photo_media_id and media.moderation_state = 'needs_review'
      ))
  order by post.created_at, post.id
  limit p_limit;
end;
$$;

create function public.moderate_social_post_admin(p_post_id uuid,p_media_id uuid,p_action text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_staff public.private_social_staff_roles; v_post public.social_posts;
begin
  select * into v_staff from public.private_social_staff_roles
  where active and revoked_at is null and role = 'moderator'
  order by created_at, id limit 1;
  if v_staff.id is null then raise exception 'staff required'; end if;
  if p_action not in ('approve','hide') then raise exception 'invalid moderation action'; end if;
  select * into v_post from public.social_posts where id = p_post_id for update;
  if v_post.id is null or v_post.photo_media_id is distinct from p_media_id
    or v_post.status <> 'visible' or v_post.moderation_state <> 'needs_review'
    then raise exception 'held post not found'; end if;
  update public.social_posts set
    moderation_state = case when p_action = 'approve' then 'approved' else 'needs_review' end,
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

revoke all on function public.read_social_post_moderation_queue_admin(integer) from public, anon, authenticated;
revoke all on function public.moderate_social_post_admin(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.read_social_post_moderation_queue_admin(integer) to service_role;
grant execute on function public.moderate_social_post_admin(uuid,uuid,text) to service_role;
