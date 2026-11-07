-- Social safety moderation: person reports, the admin report and flagged DM
-- queues, and an audited suspend (0223).
-- Captain applies; agents ship SQL only.
--
-- Reverse: supabase/migrations/rollback/20261107190000_0223_social_safety_moderation_rollback.sql
--
-- WHAT IT IS. Launch plan P0 item 6. Reports are stored (0073) and a DM report
-- sets `messages.flagged_at` (0019), but no admin screen reads either, a person
-- cannot be reported, and nothing sets `private_social_accounts.ownership_state`
-- to 'suspended' except account deletion.
--
--   1. A PERSON CAN BE REPORTED. `social_content_reports.content_kind` gains
--      'profile' (content_id is the reported profile id), and
--      `report_social_content` is restated from 0073 with ONE new branch: a
--      profile that exists and is not the reporter's own. A block does not
--      stop a report: blocking someone and reporting them go together.
--   2. TWO QUEUES FOR THE ADMIN CONSOLE, keyed by a staff role id as 0123's
--      functions are: `read_social_report_queue_admin` (open reports with the
--      reported person and a short excerpt) and `read_flagged_messages_admin`
--      (flagged DMs that no moderator has reviewed). A reviewed DM is a row in
--      the new `message_flag_reviews`, never a column on `messages`, so no
--      conversation participant can read moderator state.
--   3. AN AUDITED SUSPEND. `set_social_account_suspension_admin` moves one
--      account between 'active' and 'suspended' and writes one row to the new
--      `social_account_moderation_audit` in the same transaction. A change
--      that does not happen writes no row, and every change writes exactly one.
--      A deleted account (no auth user left) is never reinstated.
--
-- ADMIN-ONLY, TWICE. The route checks the moderator door (lib/adminAuth.ts)
-- and names the staff role (SOCIAL_MODERATOR_STAFF_ROLE_ID). In the database
-- the two new tables have RLS on with no policy and no browser grant, and every
-- function is SECURITY DEFINER, executable by service_role only, and refuses a
-- staff role that is not an active moderator. The audit table is append-only
-- even for service_role: it holds SELECT and INSERT, never UPDATE or DELETE.

begin;

-- 1. Person reports -------------------------------------------------------

alter table public.social_content_reports
  drop constraint if exists social_content_reports_content_kind_check;
alter table public.social_content_reports
  add constraint social_content_reports_content_kind_check
  check (content_kind in ('post', 'comment', 'quote', 'profile'));

create or replace function public.report_social_content(p_actor uuid, p_kind text, p_content_id uuid, p_reason text)
returns setof public.social_content_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visible boolean := false;
  v_row public.social_content_reports;
begin
  if p_kind = 'post' then
    select public.social_post_readable(post, p_actor) and not public.social_interaction_blocked(p_actor, post.author_profile_id)
    into v_visible from public.social_posts post where post.id = p_content_id;
  elsif p_kind = 'comment' then
    select comment.status = 'visible' and comment.moderation_state = 'approved'
      and public.social_post_readable(post, p_actor)
      and not public.social_interaction_blocked(p_actor, comment.author_profile_id)
      and not public.social_interaction_blocked(p_actor, post.author_profile_id)
    into v_visible from public.social_comments comment join public.social_posts post on post.id = comment.post_id where comment.id = p_content_id;
  elsif p_kind = 'quote' then
    select quote.status = 'visible' and quote.moderation_state = 'approved'
      and public.social_post_readable(post, p_actor)
      and not public.social_interaction_blocked(p_actor, quote.author_profile_id)
      and not public.social_interaction_blocked(p_actor, post.author_profile_id)
      and (
        quote.author_profile_id = p_actor
        or quote.visibility = 'public'
        or (
          quote.visibility = 'friends'
          and exists(select 1 from public.follows where follower_id = p_actor and followee_id = quote.author_profile_id)
          and exists(select 1 from public.follows where follower_id = quote.author_profile_id and followee_id = p_actor)
        )
      )
    into v_visible from public.social_quotes quote join public.social_posts post on post.id = quote.source_post_id where quote.id = p_content_id;
  elsif p_kind = 'profile' then
    -- 0223: a person. Any profile but the reporter's own, blocked or not.
    select profile.id <> p_actor
    into v_visible from public.profiles profile where profile.id = p_content_id;
  end if;
  if not coalesce(v_visible, false) then raise exception 'content not found'; end if;
  insert into public.social_content_reports(reporter_profile_id, content_kind, content_id, reason)
  values (p_actor, p_kind, p_content_id, p_reason)
  on conflict (reporter_profile_id, content_kind, content_id, reason) do update set reason = excluded.reason
  returning * into v_row;
  return next v_row;
end;
$$;

-- 2. Moderator state that no participant can read ------------------------

create table public.message_flag_reviews (
  message_id uuid primary key references public.messages(id) on delete cascade,
  staff_role_id uuid references public.private_social_staff_roles(id) on delete set null,
  reviewed_at timestamptz not null default now()
);

create table public.social_account_moderation_audit (
  id uuid primary key default gen_random_uuid(),
  -- No foreign key: the ledger outlives any change to the account row.
  social_account_id uuid not null,
  profile_handle text not null check (char_length(profile_handle) between 1 and 60),
  action text not null check (action in ('suspend', 'reinstate')),
  reason text not null check (char_length(reason) between 3 and 500),
  staff_role_id uuid references public.private_social_staff_roles(id) on delete set null,
  staff_display_name text not null check (char_length(staff_display_name) between 1 and 120),
  report_id uuid references public.social_content_reports(id) on delete set null,
  created_at timestamptz not null default now()
);

create index social_account_moderation_audit_account_idx
  on public.social_account_moderation_audit (social_account_id, created_at desc);
create index social_account_moderation_audit_staff_role_idx
  on public.social_account_moderation_audit (staff_role_id);
create index social_account_moderation_audit_report_idx
  on public.social_account_moderation_audit (report_id);
create index message_flag_reviews_staff_role_idx
  on public.message_flag_reviews (staff_role_id);
create index if not exists messages_flagged_at_idx
  on public.messages (flagged_at, id) where flagged_at is not null;

alter table public.message_flag_reviews enable row level security;
alter table public.social_account_moderation_audit enable row level security;

-- Default privileges hand service_role every right on a new table, so the
-- revoke names it too before granting back only what each table needs.
revoke all on table public.message_flag_reviews from public, anon, authenticated, service_role;
revoke all on table public.social_account_moderation_audit from public, anon, authenticated, service_role;
grant select, insert on table public.message_flag_reviews to service_role;
grant select, insert on table public.social_account_moderation_audit to service_role;

-- 3. The admin functions --------------------------------------------------

create or replace function public.read_social_report_queue_admin(p_staff_role_id uuid, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_staff public.private_social_staff_roles;
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then raise exception 'invalid queue size'; end if;
  select * into v_staff from public.private_social_staff_roles
  where id = p_staff_role_id and active and revoked_at is null and role = 'moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  return coalesce((
    select jsonb_agg(item.row_obj order by item.urgent desc, item.created_at, item.id)
    from (
      select
        report.id,
        report.created_at,
        report.reason in ('threat', 'doxxing') as urgent,
        jsonb_build_object(
          'reportId', report.id,
          'kind', report.content_kind,
          'contentId', report.content_id,
          'reason', report.reason,
          'state', report.state,
          'createdAt', to_char(report.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'reporterHandle', reporter.handle,
          'targetProfileId', target.profile_id,
          'targetHandle', target_profile.handle,
          'targetAccountState', target_account.ownership_state,
          'excerpt', target.excerpt
        ) as row_obj
      from public.social_content_reports report
      join public.profiles reporter on reporter.id = report.reporter_profile_id
      left join lateral (
        select post.author_profile_id as profile_id, left(post.body, 280) as excerpt
        from public.social_posts post
        where report.content_kind = 'post' and post.id = report.content_id
        union all
        select comment.author_profile_id, left(comment.body, 280)
        from public.social_comments comment
        where report.content_kind = 'comment' and comment.id = report.content_id
        union all
        select quote.author_profile_id, left(quote.body, 280)
        from public.social_quotes quote
        where report.content_kind = 'quote' and quote.id = report.content_id
        union all
        select profile.id, null::text
        from public.profiles profile
        where report.content_kind = 'profile' and profile.id = report.content_id
        limit 1
      ) target on true
      left join public.profiles target_profile on target_profile.id = target.profile_id
      left join public.private_social_accounts target_account on target_account.profile_id = target.profile_id
      where report.state in ('queued', 'reviewing')
      order by report.reason in ('threat', 'doxxing') desc, report.created_at, report.id
      limit p_limit
    ) item
  ), '[]'::jsonb);
end;
$$;

create or replace function public.resolve_social_report_admin(p_staff_role_id uuid, p_report_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_staff public.private_social_staff_roles;
begin
  select * into v_staff from public.private_social_staff_roles
  where id = p_staff_role_id and active and revoked_at is null and role = 'moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  update public.social_content_reports
  set state = 'resolved', resolved_at = now(), resolved_by_staff_role_id = v_staff.id
  where id = p_report_id and state in ('queued', 'reviewing');
  return found;
end;
$$;

create or replace function public.read_flagged_messages_admin(p_staff_role_id uuid, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_staff public.private_social_staff_roles;
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then raise exception 'invalid queue size'; end if;
  select * into v_staff from public.private_social_staff_roles
  where id = p_staff_role_id and active and revoked_at is null and role = 'moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  return coalesce((
    select jsonb_agg(item.row_obj order by item.flagged_at, item.id)
    from (
      select
        message.id,
        message.flagged_at,
        jsonb_build_object(
          'messageId', message.id,
          'conversationId', message.conversation_id,
          'body', left(message.body, 1000),
          'senderHandle', message.sender_handle,
          'senderProfileId', sender.id,
          'senderAccountState', sender_account.ownership_state,
          'flaggedBy', message.flagged_by,
          'flaggedAt', to_char(message.flagged_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'sentAt', to_char(message.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        ) as row_obj
      from public.messages message
      left join public.profiles sender
        on sender.id = coalesce(
          message.sender_profile_id,
          (select profile.id from public.profiles profile where profile.handle = message.sender_handle limit 1)
        )
      left join public.private_social_accounts sender_account on sender_account.profile_id = sender.id
      where message.flagged_at is not null
        and not exists (select 1 from public.message_flag_reviews review where review.message_id = message.id)
      order by message.flagged_at, message.id
      limit p_limit
    ) item
  ), '[]'::jsonb);
end;
$$;

create or replace function public.review_flagged_message_admin(p_staff_role_id uuid, p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_staff public.private_social_staff_roles;
begin
  select * into v_staff from public.private_social_staff_roles
  where id = p_staff_role_id and active and revoked_at is null and role = 'moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  if not exists (select 1 from public.messages where id = p_message_id and flagged_at is not null) then
    return false;
  end if;
  insert into public.message_flag_reviews(message_id, staff_role_id)
  values (p_message_id, v_staff.id)
  on conflict (message_id) do nothing;
  return found;
end;
$$;

create or replace function public.set_social_account_suspension_admin(
  p_staff_role_id uuid,
  p_profile_id uuid,
  p_action text,
  p_reason text,
  p_report_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff public.private_social_staff_roles;
  v_account public.private_social_accounts;
  v_handle text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_next text;
  v_audit uuid;
begin
  select * into v_staff from public.private_social_staff_roles
  where id = p_staff_role_id and active and revoked_at is null and role = 'moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  if p_action not in ('suspend', 'reinstate') or char_length(v_reason) not between 3 and 500 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if p_report_id is not null and not exists (
    select 1 from public.social_content_reports where id = p_report_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  select * into v_account from public.private_social_accounts
  where profile_id = p_profile_id
  for update;
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  -- Account deletion also leaves 'suspended' with no auth user. That account
  -- has gone; it is never reinstated and never suspended a second time.
  if v_account.supabase_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'gone');
  end if;
  v_next := case when p_action = 'suspend' then 'suspended' else 'active' end;
  if v_account.ownership_state = v_next then
    return jsonb_build_object('ok', true, 'code', 'unchanged', 'state', v_next);
  end if;
  select handle into v_handle from public.profiles where id = p_profile_id;
  update public.private_social_accounts
  set ownership_state = v_next, ownership_changed_at = now(), updated_at = now()
  where id = v_account.id;
  insert into public.social_account_moderation_audit(
    social_account_id, profile_handle, action, reason, staff_role_id, staff_display_name, report_id
  ) values (
    v_account.id, coalesce(v_handle, 'unknown'), p_action, v_reason, v_staff.id, v_staff.display_name, p_report_id
  ) returning id into v_audit;
  return jsonb_build_object('ok', true, 'code', case when p_action = 'suspend' then 'suspended' else 'reinstated' end,
    'state', v_next, 'auditId', v_audit);
end;
$$;

revoke all on function public.read_social_report_queue_admin(uuid, integer) from public, anon, authenticated;
revoke all on function public.resolve_social_report_admin(uuid, uuid) from public, anon, authenticated;
revoke all on function public.read_flagged_messages_admin(uuid, integer) from public, anon, authenticated;
revoke all on function public.review_flagged_message_admin(uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_social_account_suspension_admin(uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.read_social_report_queue_admin(uuid, integer) to service_role;
grant execute on function public.resolve_social_report_admin(uuid, uuid) to service_role;
grant execute on function public.read_flagged_messages_admin(uuid, integer) to service_role;
grant execute on function public.review_flagged_message_admin(uuid, uuid) to service_role;
grant execute on function public.set_social_account_suspension_admin(uuid, uuid, text, text, uuid) to service_role;

commit;
