-- Rollback 0236: restore the 0073 interaction job functions, the stored feature status and the 'needs_review' value.
-- The application from this change works on both shapes, so the rollback can run before or after its deploy.
-- It loses no data. A comment or quote that 0236 hid stays hidden and approved, which the old code reads as hidden.
-- A worker that claimed a job under 0236 and finishes after the rollback gets an error. The next claim takes the job
-- again when its two-minute lease ends.
begin;

drop trigger social_posts_feature_from_history on public.social_posts;
drop function public.social_post_feature_from_history();

alter table public.social_comments drop constraint social_comments_moderation_state_check;
alter table public.social_comments add constraint social_comments_moderation_state_check
  check (moderation_state in ('pending', 'approved', 'needs_review'));
alter table public.social_quotes drop constraint social_quotes_moderation_state_check;
alter table public.social_quotes add constraint social_quotes_moderation_state_check
  check (moderation_state in ('pending', 'approved', 'needs_review'));

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
    update public.social_comments set moderation_state = p_decision, updated_at = now()
    where id = p_content_id and moderation_state = 'pending'
    returning post_id, author_profile_id into v_post_id, v_author;
  elsif p_kind = 'quote' then
    update public.social_quotes set moderation_state = p_decision, updated_at = now()
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

drop function public.complete_social_interaction_moderation_job(text, uuid, uuid, text, text, timestamptz);
create function public.complete_social_interaction_moderation_job(
  p_kind text,
  p_content_id uuid,
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
  if p_decision is not null then
    return public.complete_social_interaction_moderation(p_kind, p_content_id, p_decision);
  end if;
  if p_error_code is null then raise exception 'moderation error required'; end if;
  update public.social_interaction_moderation_jobs
  set state = case when p_retry_at is null then 'error' else 'pending' end,
      next_attempt_at = coalesce(p_retry_at, next_attempt_at),
      lease_until = null,
      last_error_code = left(p_error_code, 120),
      updated_at = now()
  where content_kind = p_kind and content_id = p_content_id and state = 'leased';
  return found;
end;
$$;

drop function public.claim_social_interaction_moderation_jobs(integer);
create function public.claim_social_interaction_moderation_jobs(p_limit integer default 20)
returns table(content_kind text, content_id uuid, moderation_claim text, attempts integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit < 1 or p_limit > 50 then raise exception 'invalid moderation batch'; end if;
  update public.social_interaction_moderation_jobs job
  set state = 'error', lease_until = null, last_error_code = 'lease_expired', updated_at = now()
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
  set state = 'leased', lease_until = now() + interval '2 minutes',
      attempts = job.attempts + 1, updated_at = now()
  from candidates
  where job.content_kind = candidates.content_kind and job.content_id = candidates.content_id
  returning job.content_kind, job.content_id, job.moderation_claim, job.attempts;
end;
$$;

alter table public.social_interaction_moderation_jobs drop constraint social_interaction_moderation_jobs_lease_pair_check;
alter table public.social_interaction_moderation_jobs drop column lease_token;

revoke all on function public.complete_social_interaction_moderation(text, uuid, text) from public, anon, authenticated;
revoke all on function public.claim_social_interaction_moderation_jobs(integer) from public, anon, authenticated;
revoke all on function public.complete_social_interaction_moderation_job(text, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.complete_social_interaction_moderation(text, uuid, text),
  public.claim_social_interaction_moderation_jobs(integer),
  public.complete_social_interaction_moderation_job(text, uuid, text, text, timestamptz)
to service_role;

commit;
