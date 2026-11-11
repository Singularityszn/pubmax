-- 0236: the rest of the Social moderation guards.
-- 1. social_posts.feature_status and feature_staff_response come from social_feature_request_updates.
--    A trigger derives them on inserts and writes to kind or either feature field, preserving history across kind changes.
-- 2. An interaction moderation job gets a lease token. Only the worker with the current token can finish it.
--    The claim returns the token. The completion takes p_lease_token and the old five-argument completion is dropped.
-- 3. A comment or quote has no 'needs_review' state. No person reviews one, so a flagged one is hidden at once.
-- Apply after the code that sends p_lease_token is deployed. Older code calls the dropped five-argument completion.
begin;

create function public.social_post_feature_from_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_latest public.social_feature_request_updates;
begin
  if new.kind is distinct from 'feature_request' then
    new.feature_status := null;
    new.feature_staff_response := null;
    return new;
  end if;
  select * into v_latest from public.social_feature_request_updates update
  where update.post_id = new.id
  order by update.created_at desc, update.id desc
  limit 1;
  new.feature_status := coalesce(v_latest.status, 'submitted');
  new.feature_staff_response := v_latest.response;
  return new;
end;
$$;
revoke all on function public.social_post_feature_from_history() from public, anon, authenticated;

create trigger social_posts_feature_from_history
before insert or update of kind, feature_status, feature_staff_response on public.social_posts
for each row execute function public.social_post_feature_from_history();

update public.social_posts post
set feature_status = post.feature_status
where post.kind = 'feature_request'
  and exists (select 1 from public.social_feature_request_updates update where update.post_id = post.id);

alter table public.social_interaction_moderation_jobs add column lease_token uuid;
update public.social_interaction_moderation_jobs set lease_token = gen_random_uuid() where state = 'leased';
alter table public.social_interaction_moderation_jobs add constraint social_interaction_moderation_jobs_lease_pair_check
  check ((state = 'leased') = (lease_token is not null));

drop function public.claim_social_interaction_moderation_jobs(integer);
create function public.claim_social_interaction_moderation_jobs(p_limit integer default 20)
returns table(content_kind text, content_id uuid, moderation_claim text, attempts integer, lease_token uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit < 1 or p_limit > 50 then raise exception 'invalid moderation batch'; end if;
  update public.social_interaction_moderation_jobs job
  set state = 'error', lease_until = null, lease_token = null, last_error_code = 'lease_expired', updated_at = now()
  where job.state = 'leased' and job.lease_until <= now() and job.attempts >= 8;
  return query
  with candidates as (
    select job.content_kind, job.content_id
    from public.social_interaction_moderation_jobs job
    where job.attempts < 8 and (
      (job.state = 'pending' and job.next_attempt_at <= now())
      or (job.state = 'leased' and job.lease_until <= now())
    )
    order by job.next_attempt_at, job.created_at
    for update skip locked limit p_limit
  )
  update public.social_interaction_moderation_jobs job
  set state = 'leased', lease_until = now() + interval '2 minutes', lease_token = gen_random_uuid(),
      attempts = job.attempts + 1, updated_at = now()
  from candidates
  where job.content_kind = candidates.content_kind and job.content_id = candidates.content_id
  returning job.content_kind, job.content_id, job.moderation_claim, job.attempts, job.lease_token;
end;
$$;

drop function public.complete_social_interaction_moderation_job(text, uuid, text, text, timestamptz);
create function public.complete_social_interaction_moderation_job(
  p_kind text,
  p_content_id uuid,
  p_lease_token uuid,
  p_decision text,
  p_error_code text,
  p_retry_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_decision is null and p_error_code is null then raise exception 'moderation error required'; end if;
  perform 1 from public.social_interaction_moderation_jobs
  where content_kind = p_kind and content_id = p_content_id and state = 'leased' and lease_token = p_lease_token
  for update;
  if not found then return false; end if;
  if p_decision is not null then
    return public.complete_social_interaction_moderation(p_kind, p_content_id, p_decision);
  end if;
  update public.social_interaction_moderation_jobs
  set state = case when p_retry_at is null then 'error' else 'pending' end,
      next_attempt_at = coalesce(p_retry_at, next_attempt_at),
      lease_until = null,
      lease_token = null,
      last_error_code = left(p_error_code, 120),
      updated_at = now()
  where content_kind = p_kind and content_id = p_content_id;
  return true;
end;
$$;

-- 'needs_review' stays the provider's word for a flagged text. The row it leaves is hidden and checked.
create or replace function public.complete_social_interaction_moderation(p_kind text, p_content_id uuid, p_decision text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_id uuid;
  v_author uuid;
  v_recipient uuid;
begin
  if p_decision not in ('approved', 'needs_review') then raise exception 'invalid moderation decision'; end if;
  if p_kind = 'comment' then
    update public.social_comments
    set moderation_state = 'approved',
        status = case when p_decision = 'needs_review' then 'hidden' else status end,
        updated_at = now()
    where id = p_content_id and moderation_state = 'pending'
    returning post_id, author_profile_id into v_post_id, v_author;
  elsif p_kind = 'quote' then
    update public.social_quotes
    set moderation_state = 'approved',
        status = case when p_decision = 'needs_review' then 'hidden' else status end,
        updated_at = now()
    where id = p_content_id and moderation_state = 'pending'
    returning source_post_id, author_profile_id into v_post_id, v_author;
  else raise exception 'invalid moderation kind'; end if;
  if v_post_id is null then return false; end if;
  delete from public.social_interaction_moderation_jobs where content_kind = p_kind and content_id = p_content_id;
  if p_decision = 'approved' then
    select author_profile_id into v_recipient from public.social_posts where id = v_post_id;
    if v_recipient is not null and v_recipient <> v_author then
      insert into public.social_notifications(recipient_profile_id, actor_profile_id, kind, source_post_id, source_content_id)
      values (v_recipient, v_author, p_kind, v_post_id, p_content_id) on conflict do nothing;
    end if;
  end if;
  return true;
end;
$$;

update public.social_comments set status = 'hidden', moderation_state = 'approved', updated_at = now()
where moderation_state = 'needs_review';
update public.social_quotes set status = 'hidden', moderation_state = 'approved', updated_at = now()
where moderation_state = 'needs_review';
alter table public.social_comments drop constraint social_comments_moderation_state_check;
alter table public.social_comments add constraint social_comments_moderation_state_check
  check (moderation_state in ('pending', 'approved'));
alter table public.social_quotes drop constraint social_quotes_moderation_state_check;
alter table public.social_quotes add constraint social_quotes_moderation_state_check
  check (moderation_state in ('pending', 'approved'));

revoke all on function public.complete_social_interaction_moderation(text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.claim_social_interaction_moderation_jobs(integer) from public, anon, authenticated;
revoke all on function public.complete_social_interaction_moderation_job(text, uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_social_interaction_moderation_jobs(integer),
  public.complete_social_interaction_moderation_job(text, uuid, uuid, text, text, timestamptz)
to service_role;

commit;
