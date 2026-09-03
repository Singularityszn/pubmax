-- Restore exact 0124 private 0075 bodies.
--
-- This deliberately reopens stale replay for active members. The forward
-- migration changes no wrapper, table, index, or privilege, so rollback only
-- restores the two private function bodies.

begin;

create or replace function public._0075_join_plan_idempotent_atomic(
  p_plan_id uuid,
  p_member_id uuid,
  p_member_name text,
  p_token_hash text,
  p_joined_at timestamptz,
  p_can_collaborate boolean,
  p_idempotency_key_hash text,
  p_request_hash text
) returns text
language plpgsql security invoker set search_path = ''
as $$
declare existing_member public.plan_crew_members%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('plan:join:' || p_plan_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('plan:join:' || p_plan_id::text || ':' || p_idempotency_key_hash, 0));
  select * into existing_member from public.plan_crew_members
  where plan_id = p_plan_id and join_key_hash = p_idempotency_key_hash for update;
  if found then
    if existing_member.join_request_hash <> p_request_hash or existing_member.id <> p_member_id then
      return 'conflict';
    end if;
    if existing_member.membership_revoked_at is null then return 'replayed'; end if;
    if (
      select count(*) from public.plan_crew_members
      where plan_id = p_plan_id and membership_revoked_at is null
    ) >= 20 then return 'full'; end if;
    update public.plan_crew_members
    set name = p_member_name,
        token_hash = p_token_hash,
        status = 'in',
        updated_at = p_joined_at,
        can_collaborate = p_can_collaborate,
        membership_revoked_at = null
    where id = existing_member.id;
    return 'joined';
  end if;
  if not exists (select 1 from public.plans where id = p_plan_id) then return 'not_found'; end if;
  if (
    select count(*) from public.plan_crew_members
    where plan_id = p_plan_id and membership_revoked_at is null
  ) >= 20 then return 'full'; end if;
  insert into public.plan_crew_members
    (id, plan_id, name, token_hash, status, joined_at, updated_at, can_collaborate, join_key_hash, join_request_hash)
  values
    (p_member_id, p_plan_id, p_member_name, p_token_hash, 'in', p_joined_at, p_joined_at, p_can_collaborate, p_idempotency_key_hash, p_request_hash);
  return 'joined';
end;
$$;

create or replace function public._0075_redeem_plan_invite_idempotent_atomic(
  p_plan_id uuid,
  p_invite_token_hash text,
  p_member_id uuid,
  p_member_name text,
  p_member_token_hash text,
  p_joined_at timestamptz,
  p_idempotency_key_hash text,
  p_request_hash text
) returns text
language plpgsql security invoker set search_path = ''
as $$
declare invite public.plan_invites%rowtype;
declare existing_member public.plan_crew_members%rowtype;
declare reactivate boolean := false;
begin
  perform pg_advisory_xact_lock(hashtextextended('plan:join:' || p_plan_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('plan:invite-join:' || p_plan_id::text || ':' || p_idempotency_key_hash, 0));
  select * into existing_member from public.plan_crew_members
  where plan_id = p_plan_id and join_key_hash = p_idempotency_key_hash for update;
  if found then
    if existing_member.join_request_hash <> p_request_hash or existing_member.id <> p_member_id then
      return 'conflict';
    end if;
    if existing_member.membership_revoked_at is null then return 'replayed'; end if;
    reactivate := true;
  end if;

  select * into invite from public.plan_invites
  where plan_id = p_plan_id and token_hash = p_invite_token_hash for update;
  if not found then return 'not_found'; end if;
  if invite.revoked_at is not null then return 'revoked'; end if;
  if invite.expires_at <= p_joined_at then return 'expired'; end if;
  if invite.redeemed_at is not null then return 'capability_replayed'; end if;
  if (
    select count(*) from public.plan_crew_members
    where plan_id = p_plan_id and membership_revoked_at is null
  ) >= 20 then return 'full'; end if;

  if reactivate then
    update public.plan_crew_members
    set name = p_member_name,
        token_hash = p_member_token_hash,
        status = 'in',
        updated_at = p_joined_at,
        can_collaborate = true,
        membership_revoked_at = null
    where id = existing_member.id;
  else
    insert into public.plan_crew_members
      (id, plan_id, name, token_hash, status, joined_at, updated_at, can_collaborate, join_key_hash, join_request_hash)
    values
      (p_member_id, p_plan_id, p_member_name, p_member_token_hash, 'in', p_joined_at, p_joined_at, true, p_idempotency_key_hash, p_request_hash);
  end if;
  update public.plan_invites set redeemed_at = p_joined_at where id = invite.id;
  return 'joined';
end;
$$;

commit;
