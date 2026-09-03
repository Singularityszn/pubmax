-- Rollback for 0136: put both account-join prechecks back as 0134 wrote them.
--
-- This restores the state where an account whose only prior seat on a Plan was
-- revoked is refused with `account_conflict` before `claim_plan_membership` is
-- reached. That is the defect 0136 exists to close, so rolling back reopens it
-- deliberately rather than by accident.
--
-- The two bodies below are 0134's, unchanged. `security definer` and
-- `set search_path = ''` are restated because `create or replace function`
-- drops any SET clause it does not carry.

begin;

create or replace function public.join_plan_account_idempotent_atomic(
  p_plan_id uuid,
  p_member_id uuid,
  p_member_name text,
  p_token_hash text,
  p_joined_at timestamptz,
  p_can_collaborate boolean,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_user_id uuid
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_join text;
  v_claim text;
  v_constraint_name text;
  v_transition text;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(
      'plan:join-account:' || p_plan_id::text || ':' || p_user_id::text,
      0
    )
  );

  v_transition := public._reconcile_plan_account_join(
    p_plan_id,
    p_member_id,
    p_member_name,
    p_token_hash,
    p_idempotency_key_hash,
    p_request_hash,
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          '{"name":' || pg_catalog.to_json(p_member_name)::text ||
          ',"collaborationAuthorized":' ||
          case when p_can_collaborate then 'true' else 'false' end || '}',
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    p_can_collaborate,
    p_user_id
  );
  if v_transition <> 'absent' then return v_transition; end if;

  if exists (
    select 1
    from public.plan_crew_members
    where plan_id = p_plan_id
      and user_id = p_user_id
  ) then
    return 'account_conflict';
  end if;

  begin
    v_join := public.join_plan_idempotent_atomic(
      p_plan_id,
      p_member_id,
      p_member_name,
      p_token_hash,
      p_joined_at,
      p_can_collaborate,
      p_idempotency_key_hash,
      p_request_hash
    );
    if v_join not in ('joined', 'replayed') then
      return v_join;
    end if;

    v_claim := public.claim_plan_membership(
      p_plan_id,
      p_member_id,
      p_user_id
    );
    if v_claim in ('claimed', 'already_claimed') then
      return v_join;
    end if;
    raise exception 'plan account join refused' using errcode = 'P0001';
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'plan_crew_members_plan_user_unique_idx' then
        return 'account_conflict';
      end if;
      return 'conflict';
    when sqlstate 'P0001' then
      if v_claim = 'not_found' then return 'not_found'; end if;
      return 'account_conflict';
  end;
end;
$$;

create or replace function public.redeem_plan_invite_account_idempotent_atomic(
  p_plan_id uuid,
  p_invite_token_hash text,
  p_member_id uuid,
  p_member_name text,
  p_member_token_hash text,
  p_joined_at timestamptz,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_user_id uuid
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_join text;
  v_claim text;
  v_constraint_name text;
  v_transition text;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(
      'plan:join-account:' || p_plan_id::text || ':' || p_user_id::text,
      0
    )
  );

  v_transition := public._reconcile_plan_account_join(
    p_plan_id,
    p_member_id,
    p_member_name,
    p_member_token_hash,
    p_idempotency_key_hash,
    p_request_hash,
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          '{"name":' || pg_catalog.to_json(p_member_name)::text ||
          ',"inviteHash":' || pg_catalog.to_json(p_invite_token_hash)::text || '}',
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    true,
    p_user_id
  );
  if v_transition <> 'absent' then return v_transition; end if;

  if exists (
    select 1
    from public.plan_crew_members
    where plan_id = p_plan_id
      and user_id = p_user_id
  ) then
    return 'account_conflict';
  end if;

  begin
    v_join := public.redeem_plan_invite_idempotent_atomic(
      p_plan_id,
      p_invite_token_hash,
      p_member_id,
      p_member_name,
      p_member_token_hash,
      p_joined_at,
      p_idempotency_key_hash,
      p_request_hash
    );
    if v_join not in ('joined', 'replayed') then
      return v_join;
    end if;

    v_claim := public.claim_plan_membership(
      p_plan_id,
      p_member_id,
      p_user_id
    );
    if v_claim in ('claimed', 'already_claimed') then
      return v_join;
    end if;
    raise exception 'plan account invite join refused' using errcode = 'P0001';
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'plan_crew_members_plan_user_unique_idx' then
        return 'account_conflict';
      end if;
      return 'conflict';
    when sqlstate 'P0001' then
      if v_claim = 'not_found' then return 'not_found'; end if;
      return 'account_conflict';
  end;
end;
$$;

revoke all on function public.join_plan_account_idempotent_atomic(
  uuid, uuid, text, text, timestamptz, boolean, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.redeem_plan_invite_account_idempotent_atomic(
  uuid, text, uuid, text, text, timestamptz, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.join_plan_account_idempotent_atomic(
  uuid, uuid, text, text, timestamptz, boolean, text, text, uuid
) to service_role;
grant execute on function public.redeem_plan_invite_account_idempotent_atomic(
  uuid, text, uuid, text, text, timestamptz, text, text, uuid
) to service_role;

commit;
