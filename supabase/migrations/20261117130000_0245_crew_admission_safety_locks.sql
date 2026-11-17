-- 0245: crew admission and invitation refuse blocked and removed people, under the
-- auth row and participant-account locks that blocks, suspension, provisioning and
-- account deletion share. Covered functions only; no whole-database claim.
--
-- 1. _lock_social_participant_accounts takes one advisory lock per participant account,
--    in account-ID order. A later pair lock comes after these.
-- 2. _social_crew_admission_ineligible is the one read-only rule: the person is not
--    active, this crew removed them, or a block either way joins them to an accepted
--    member who still has an account. A member whose deletion finished bars nobody with
--    kept blocks, and 0246 frees their place; a suspended member with an
--    account still bars. _social_crew_admission_refused locks, then asks the rule in a
--    new statement. Capacity is at most 20, so an admission takes at most 21 locks.
-- 3. Request, decision, invitation and acceptance answer not_found, as for an unknown
--    crew, when the rule refuses. The rule runs before already_pending; a replayed key
--    returns its stored answer first. After the locks a decision and an invitation
--    recheck the actor's owner or cohost role, and an acceptance rechecks Mutual with
--    the owner and the inviter's active owner or cohost place. The host queue hides
--    refused requests and takes no lock. A requester cancels their own request, and an
--    invitee declines, with no admission check.
-- 4. Lock order:
--    - The four admission functions: crew row, the request or invitation row, the
--      person's auth row (KEY SHARE), account locks, plan join lock, seat rows. Crew,
--      request and invitation rows touched later belong to the crew they hold.
--    - correct_social_crew_removal_admin: crew row, member row, subject's auth row
--      (KEY SHARE), subject's account lock, ledger. No seat.
--    - auth.users DELETE holds the auth row before any trigger. Its first BEFORE DELETE
--      trigger, lock_social_accounts_on_auth_user_delete, takes the account lock, then
--      the person's own Plan and seat rows, before 0198's tombstone writes the account
--      and profile rows. It touches no crew, request or invitation row.
--    - set_social_account_suspension_admin: supabase user lock, auth row (KEY SHARE),
--      account lock, profile and account rows.
--    - provision_social_product_account: supabase user lock, auth row (KEY SHARE),
--      profile and account rows. No account lock: it never changes ownership_state.
--    - A block insert, or an update that moves a block, takes the account locks of
--      every person it names through social_blocks_lock_participant_accounts.
--    - _social_crew_finish_write, the last step of every Crew write, locks the actor's
--      account row (KEY SHARE) before its receipt.
--    A deletion in flight makes the others wait and then refuse; one that starts later
--    waits and then completes. migrate_social_product_account (0071) and other writers
--    of these rows are outside this order and unproven.
-- 5. A row lock on auth.users needs UPDATE on it, which the first statement checks.
--    The internal helpers are revoked from every role, the service role included.
-- 6. A block between two accepted members changes no membership and pauses nothing.
-- 7. Removal bars that one crew; it is not a suspension. Only an active moderator who
--    is not the removed person lifts it through the service-only
--    correct_social_crew_removal_admin, with a reason: 'removed' becomes 'left', the
--    authority revision moves, and one row goes to the append-only
--    social_crew_removal_corrections. No seat is taken. A row is deleted with its
--    subject's account (subject_user_id) and with its crew (crew_id). A subject with no
--    bound auth user, or one deleted while the correction waits, gets 'gone'. Only the
--    service role reads or adds rows. The own-record export is outside this migration.
-- 8. Private Crew write receipts end with their account. When deletion unbinds an
--    account, social_account_unbind_purges_crew_receipts deletes its receipts in the
--    same transaction. A Crew write whose actor was deleted while it waited fails whole,
--    with no receipt; a refusal keeps its neutral answer and stores no receipt. Applying 0245 also deletes receipts
--    already left by deleted accounts (unbound, profile tombstoned). Suspended and
--    unbound legacy accounts keep theirs. Deleted receipts cannot be restored.
-- 9. A crew-bound Plan can be deleted, with its crew history. The seat reference from
--    member rows is checked at commit. Nothing in the app deletes a Plan; the operator
--    transaction locks the crew row, then the Plan row, then deletes the Plan
--    (docs/CREW_REMOVAL_CORRECTION_RUNBOOK.md), the order admission uses.
-- 0246 frees deleted members' places and cancels their nights. 0071 stays held outside.
--
-- Rollback restores the 0110, 0114, 0075, 0092 and 0224 bodies and the RESTRICT seat
-- reference, and drops the social_blocks and account triggers, helpers, correction
-- function and ledger. It cannot drop a trigger on auth.users, which the migration role
-- does not own: it leaves lock_social_accounts_on_auth_user_delete with a function that
-- returns at once, and reapplying checks and reuses that trigger. It waits for
-- auth.users holding nothing, takes every other lock without waiting, and stops while
-- the ledger holds rows unless the session names their exact exported snapshot.
begin;

-- A row lock on auth.users needs UPDATE on it. Without that this migration stops here.
do $$
begin
  if not pg_catalog.has_any_column_privilege('auth.users','UPDATE') then
    raise exception '0245 needs UPDATE on auth.users to lock a candidate''s auth row';
  end if;
end;
$$;

-- An account deletion locks auth.users first. This migration adds a trigger and a
-- foreign key on auth.users, so it takes auth.users first and no deletion interleaves.
lock table auth.users in share row exclusive mode;

-- Item 9: checked at commit, a crew-bound Plan delete completes, and a lone seat delete
-- that would leave a member row behind still fails. The other two stay RESTRICT.
alter table public.social_crew_members
  drop constraint social_crew_members_plan_member_id_fkey,
  add constraint social_crew_members_plan_member_id_fkey
    foreign key (plan_member_id) references public.plan_crew_members(id)
    on delete no action deferrable initially deferred;

create function public._lock_social_participant_accounts(p_accounts uuid[])
returns void language plpgsql security definer set search_path=''
as $$
declare v_account uuid;
begin
  for v_account in
    select distinct listed.account from unnest(p_accounts) as listed(account)
    where listed.account is not null order by listed.account
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('social-account:' || v_account::text, 0));
  end loop;
end;
$$;

create function public._social_crew_admission_ineligible(p_crew uuid,p_account uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select not exists(
      select 1 from public.private_social_accounts
      where id=p_account and ownership_state='active')
    or exists(
      select 1 from public.social_crew_members
      where crew_id=p_crew and social_account_id=p_account and state='removed')
    or exists(
      select 1
      from public.private_social_accounts candidate
      join public.social_crew_members member
        on member.crew_id=p_crew and member.state='active' and member.social_account_id<>candidate.id
      join public.private_social_accounts other
        on other.id=member.social_account_id and other.supabase_user_id is not null
      join public.social_blocks block
        on (block.blocker_profile_id=candidate.profile_id and block.blocked_profile_id=other.profile_id)
        or (block.blocker_profile_id=other.profile_id and block.blocked_profile_id=candidate.profile_id)
      where candidate.id=p_account);
$$;

-- The caller holds the crew row lock, so the accepted roster cannot change here.
create function public._social_crew_admission_refused(p_crew uuid,p_account uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
begin
  -- auth.users DELETE holds this row before its triggers take the account lock, and a
  -- new plan seat checks this row through its foreign key. Taking it first keeps one order.
  perform 1 from auth.users auth_user
    join public.private_social_accounts account on account.supabase_user_id=auth_user.id
    where account.id=p_account
    for key share of auth_user;
  perform public._lock_social_participant_accounts(array(
    select member.social_account_id from public.social_crew_members member
    where member.crew_id=p_crew and member.state='active'
  ) || p_account);
  return public._social_crew_admission_ineligible(p_crew,p_account);
end;
$$;

create function public._lock_social_block_participants()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  perform public._lock_social_participant_accounts(array(
    select account.id from public.private_social_accounts account
    where account.profile_id in (new.blocker_profile_id,new.blocked_profile_id)
      or (tg_op='UPDATE' and account.profile_id in (old.blocker_profile_id,old.blocked_profile_id))
  ));
  return new;
end;
$$;

create trigger social_blocks_lock_participant_accounts
before insert or update of blocker_profile_id, blocked_profile_id on public.social_blocks
for each row execute function public._lock_social_block_participants();

-- Named to fire before profiles_tombstone_on_auth_user_delete: BEFORE triggers run
-- in name order, so the account lock comes before the tombstone's row writes.
-- create or replace: a rollback leaves this function, inert, because the migration
-- role does not own auth.users and so cannot drop the trigger that calls it.
create or replace function public._lock_social_auth_user_accounts()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  perform public._lock_social_participant_accounts(array(
    select account.id from public.private_social_accounts account
    where account.supabase_user_id=old.id
  ));
  -- Before the tombstone writes the account row: a Crew write locks a seat row before
  -- it locks the account row for its receipt.
  perform 1 from public.plans where owner_user_id=old.id for update;
  perform 1 from public.plan_crew_members where user_id=old.id for update;
  return old;
end;
$$;

-- The last step of every Crew write. It waits for an account deletion in flight. If the
-- actor was deleted meanwhile, a write fails whole and a refusal keeps its neutral
-- answer; neither stores a receipt.
create or replace function public._social_crew_finish_write(
  p_actor uuid, p_operation text, p_key text, p_digest text, p_response jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.private_social_accounts where id=p_actor for key share;
  if exists(select 1 from public.private_social_accounts account
      join public.profiles profile on profile.id=account.profile_id
      where account.id=p_actor and account.supabase_user_id is null and profile.tombstoned_at is not null) then
    if p_response @> '{"ok":false}'::jsonb then return p_response; end if;
    raise exception 'social crew write refused: the account was deleted' using errcode='55000';
  end if;
  insert into public.private_social_crew_write_receipts(
    actor_account_id,operation,idempotency_key,payload_digest,response
  ) values(p_actor,p_operation,p_key,p_digest,p_response);
  return p_response;
end;
$$;

-- Only account deletion unbinds an account. Its receipts go in the same transaction.
create function public._purge_social_crew_receipts_on_unbind()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  delete from public.private_social_crew_write_receipts where actor_account_id=new.id;
  return new;
end;
$$;

create trigger social_account_unbind_purges_crew_receipts
after update of supabase_user_id on public.private_social_accounts
for each row when (old.supabase_user_id is not null and new.supabase_user_id is null)
execute function public._purge_social_crew_receipts_on_unbind();

-- Receipts already left by accounts deleted before 0245. Not restored by rollback.
delete from public.private_social_crew_write_receipts receipt
using public.private_social_accounts account, public.profiles profile
where account.id=receipt.actor_account_id and profile.id=account.profile_id
  and account.supabase_user_id is null and profile.tombstoned_at is not null;

-- Create the trigger, or reuse the one a rollback left only when it is exactly this
-- one: BEFORE DELETE, FOR EACH ROW, enabled, no condition, no arguments, this function.
do $$
declare v_trigger record;
begin
  select t.tgfoid, t.tgtype, t.tgenabled, t.tgisinternal, t.tgnargs, t.tgqual,
         pg_catalog.cardinality(t.tgattr::int2[]) as attrs
    into v_trigger
    from pg_catalog.pg_trigger t
   where t.tgrelid = 'auth.users'::regclass and t.tgname = 'lock_social_accounts_on_auth_user_delete';
  if not found then
    create trigger lock_social_accounts_on_auth_user_delete
    before delete on auth.users
    for each row execute function public._lock_social_auth_user_accounts();
  elsif v_trigger.tgfoid <> 'public._lock_social_auth_user_accounts()'::regprocedure
    or v_trigger.tgtype <> 11 or v_trigger.tgenabled <> 'O' or v_trigger.tgisinternal
    or v_trigger.tgnargs <> 0 or v_trigger.tgqual is not null or v_trigger.attrs <> 0 then
    raise exception '0245 found a different trigger named lock_social_accounts_on_auth_user_delete on auth.users. Its owner must remove it first.';
  end if;
end;
$$;

create or replace function public.request_social_crew_join_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_action text,p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_replay jsonb; v_owner uuid; v_visibility text; v_rel text; v_expiry timestamptz;
  v_request public.social_crew_join_requests%rowtype;
  v_id uuid:=gen_random_uuid(); v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.social_crews where id=p_crew_id for update;
  select owner_account_id, visibility into v_owner, v_visibility from public.social_crews where id=p_crew_id;
  if v_owner is null then
    return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'not_found'); end if;
  if p_action='cancelled' then
    select * into v_request from public.social_crew_join_requests
      where crew_id=p_crew_id and requester_account_id=p_actor_account_id and state='pending' for update;
    if not found then return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'not_found'); end if;
    update public.social_crew_join_requests set state='cancelled',decided_at=now() where id=v_request.id;
    v_response:=jsonb_build_object('ok',true,'code','cancelled','request_id',v_request.id);
  elsif p_action='pending' then
    v_rel:=public._social_crew_relationship_between_accounts(p_actor_account_id,v_owner);
    if (v_visibility='open' and v_rel is not distinct from 'blocked')
      or (v_visibility<>'open' and v_rel is distinct from 'mutual') then
      return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'not_found'); end if;
    v_expiry:=public._social_crew_plan_expiry(p_crew_id);
    if v_expiry is null or v_expiry<=now() then
      return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,
        case when exists(select 1 from public.social_crews crew join public.plans plan on plan.id=crew.plan_id where crew.id=p_crew_id and plan.status='abandoned') then 'not_found' else 'invalid' end); end if;
    update public.social_crew_join_requests set state='expired',decided_at=now()
      where crew_id=p_crew_id and requester_account_id=p_actor_account_id and state='pending' and now()>=expires_at;
    if exists(select 1 from public.social_crew_members
      where crew_id=p_crew_id and social_account_id=p_actor_account_id and state='active') then
      return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'already_member'); end if;
    if public._social_crew_admission_refused(p_crew_id,p_actor_account_id) then
      return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'not_found'); end if;
    if exists(select 1 from public.social_crew_join_requests
      where crew_id=p_crew_id and requester_account_id=p_actor_account_id and state='pending') then
      return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'already_pending'); end if;
    insert into public.social_crew_join_requests(id,crew_id,requester_account_id,expires_at)
      values(v_id,p_crew_id,p_actor_account_id,v_expiry);
    v_response:=jsonb_build_object('ok',true,'code','requested','request_id',v_id);
  else return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'invalid'); end if;
  return public._social_crew_finish_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,v_response);
end;
$$;

create or replace function public.decide_social_crew_join_request_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_request_id uuid,p_decision text,p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_operation text:='join-decision:'||p_crew_id::text; v_replay jsonb;
  v_request public.social_crew_join_requests%rowtype; v_role text; v_decider uuid; v_owner uuid;
  v_visibility text; v_rel text; v_member uuid; v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.social_crews where id=p_crew_id for update;
  if not found then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
  select * into v_request from public.social_crew_join_requests
    where id=p_request_id and crew_id=p_crew_id for update;
  if not found then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
  v_role:=public._social_crew_member_role(p_crew_id,p_actor_account_id);
  if v_role is null or v_role not in ('owner','cohost') then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
  if v_request.state<>'pending' then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'already_decided'); end if;
  if now()>=v_request.expires_at then
    update public.social_crew_join_requests set state='expired',decided_at=now() where id=v_request.id;
    return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'expired'); end if;
  select id into v_decider from public.social_crew_members where crew_id=p_crew_id and social_account_id=p_actor_account_id and state='active';
  if p_decision='accepted' then
    select owner_account_id, visibility into v_owner, v_visibility from public.social_crews where id=p_crew_id;
    v_rel:=public._social_crew_relationship_between_accounts(v_request.requester_account_id,v_owner);
    if v_visibility = 'open' then
      if v_rel is distinct from 'blocked' then
        null;
      else
        return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found');
      end if;
    elsif v_rel is distinct from 'mutual' then
      return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found');
    end if;
    if public._social_crew_admission_refused(p_crew_id,v_request.requester_account_id) then
      return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
    -- A new statement, so it reads what committed while the account locks waited.
    if not exists(select 1 from public.private_social_accounts where id=p_actor_account_id and ownership_state='active')
      or coalesce(public._social_crew_member_role(p_crew_id,p_actor_account_id),'') not in ('owner','cohost') then
      return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
    v_member:=public._activate_social_crew_member(p_crew_id,v_request.requester_account_id);
    if v_member is null then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'full'); end if;
    v_response:=jsonb_build_object('ok',true,'code','accepted','member_id',v_member);
  elsif p_decision='declined' then v_response:=jsonb_build_object('ok',true,'code','declined');
  else return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'invalid'); end if;
  update public.social_crew_join_requests set state=p_decision,decided_at=now(),decided_by_member_id=v_decider where id=v_request.id;
  return public._social_crew_finish_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,v_response);
end;
$$;

create or replace function public.invite_social_crew_member_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_target_profile_id uuid,
  p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_replay jsonb; v_role text; v_target uuid; v_owner uuid; v_expiry timestamptz;
  v_id uuid:=gen_random_uuid(); v_inviter uuid; v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.social_crews where id=p_crew_id for update;
  v_role:=public._social_crew_member_role(p_crew_id,p_actor_account_id);
  if v_role is null or v_role not in ('owner','cohost') then return public._social_crew_fail_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest,'not_found'); end if;
  select account.id into v_target from public.private_social_accounts account
    where account.profile_id=p_target_profile_id and account.ownership_state='active';
  select owner_account_id into v_owner from public.social_crews where id=p_crew_id;
  if v_target is null or v_target=v_owner or public._social_crew_relationship_between_accounts(v_target,v_owner) is distinct from 'mutual'
    then return public._social_crew_fail_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest,'not_found'); end if;
  v_expiry:=public._social_crew_plan_expiry(p_crew_id);
  if v_expiry is null or v_expiry<=now() then return public._social_crew_fail_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest,'invalid'); end if;
  update public.social_crew_invitations set state='expired',decided_at=now()
    where crew_id=p_crew_id and target_account_id=v_target and state='pending' and now()>=expires_at;
  if exists(select 1 from public.social_crew_members where crew_id=p_crew_id and social_account_id=v_target and state='active') then
    return public._social_crew_fail_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest,'already_member'); end if;
  if public._social_crew_admission_refused(p_crew_id,v_target) then
    return public._social_crew_fail_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest,'not_found'); end if;
  if not exists(select 1 from public.private_social_accounts where id=p_actor_account_id and ownership_state='active')
    or coalesce(public._social_crew_member_role(p_crew_id,p_actor_account_id),'') not in ('owner','cohost') then
    return public._social_crew_fail_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest,'not_found'); end if;
  if exists(select 1 from public.social_crew_invitations
    where crew_id=p_crew_id and target_account_id=v_target and state='pending') then
    return public._social_crew_fail_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest,'already_pending'); end if;
  select id into v_inviter from public.social_crew_members where crew_id=p_crew_id and social_account_id=p_actor_account_id and state='active';
  insert into public.social_crew_invitations(id,crew_id,target_account_id,invited_by_member_id,expires_at)
    values(v_id,p_crew_id,v_target,v_inviter,v_expiry);
  v_response:=jsonb_build_object('ok',true,'code','invited','invitation_id',v_id);
  return public._social_crew_finish_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest,v_response);
end;
$$;

create or replace function public.accept_social_crew_invitation_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_invitation_id uuid,p_action text,
  p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_operation text:='invitation-action:'||p_crew_id::text; v_replay jsonb;
  v_row public.social_crew_invitations%rowtype; v_owner uuid; v_member uuid; v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.social_crews where id=p_crew_id for update;
  if not found then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
  select * into v_row from public.social_crew_invitations
    where id=p_invitation_id and crew_id=p_crew_id for update;
  if not found or v_row.target_account_id<>p_actor_account_id then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
  if v_row.state<>'pending' then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'already_decided'); end if;
  if now()>=v_row.expires_at then
    update public.social_crew_invitations set state='expired',decided_at=now() where id=v_row.id;
    return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'expired');
  end if;
  if p_action='declined' then
    update public.social_crew_invitations set state='declined',decided_at=now() where id=v_row.id;
    v_response:=jsonb_build_object('ok',true,'code','declined');
  elsif p_action='accepted' then
    select owner_account_id into v_owner from public.social_crews where id=p_crew_id;
    if public._social_crew_relationship_between_accounts(p_actor_account_id,v_owner) is distinct from 'mutual' then
      return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
    if public._social_crew_admission_refused(p_crew_id,p_actor_account_id) then
      return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
    -- A new statement, so it reads suspensions and deletions that committed while the
    -- account locks waited. Removal, leaving and role changes need the crew row we hold.
    if public._social_crew_relationship_between_accounts(p_actor_account_id,v_owner) is distinct from 'mutual'
      or not exists(select 1 from public.social_crew_members inviter
        join public.private_social_accounts account on account.id=inviter.social_account_id
        where inviter.id=v_row.invited_by_member_id and inviter.crew_id=p_crew_id
          and inviter.state='active' and account.ownership_state='active'
          and public._social_crew_member_role(p_crew_id,inviter.social_account_id) in ('owner','cohost')) then
      return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
    v_member:=public._activate_social_crew_member(p_crew_id,p_actor_account_id);
    if v_member is null then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'full'); end if;
    update public.social_crew_invitations set state='accepted',decided_at=now() where id=v_row.id;
    v_response:=jsonb_build_object('ok',true,'code','accepted','member_id',v_member);
  else return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'invalid'); end if;
  return public._social_crew_finish_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,v_response);
end;
$$;

create or replace function public.read_social_crew_join_requests(
  p_viewer_account_id uuid,
  p_viewer_profile_id uuid,
  p_crew_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select account.id
    from public.private_social_accounts account
    join public.profiles profile on profile.id = account.profile_id
    where account.id = p_viewer_account_id
      and account.profile_id = p_viewer_profile_id
      and account.ownership_state = 'active'
  ),
  manager as (
    select crew.id as crew_id, crew.owner_account_id
    from actor
    join public.social_crews crew on crew.id = p_crew_id
    join public.plans plan
      on plan.id = crew.plan_id
      and plan.social_owner_account_id = crew.owner_account_id
    join public.private_social_accounts owner_account
      on owner_account.id = crew.owner_account_id
      and owner_account.ownership_state = 'active'
    join public.social_crew_members owner_member
      on owner_member.crew_id = crew.id
      and owner_member.social_account_id = crew.owner_account_id
      and owner_member.role = 'owner'
      and owner_member.state = 'active'
    join public.plan_crew_members owner_plan_member
      on owner_plan_member.id = owner_member.plan_member_id
      and owner_plan_member.plan_id = crew.plan_id
      and owner_plan_member.social_account_id = crew.owner_account_id
    join public.social_crew_members member
      on member.crew_id = crew.id
      and member.social_account_id = actor.id
      and member.state = 'active'
    join public.plan_crew_members plan_member
      on plan_member.id = member.plan_member_id
      and plan_member.plan_id = crew.plan_id
      and plan_member.social_account_id = actor.id
    where public._social_crew_member_role(p_crew_id, actor.id)
      in ('owner','cohost')
      and crew.visibility = 'open'
  )
  select jsonb_build_object(
    'items',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'requestId', pending.id,
          'requesterHandle', pending.handle
        ) order by pending.created_at, pending.id
      )
      from (
        select request.id, profile.handle,
          request.created_at, request.expires_at
        from public.social_crew_join_requests request
        join public.private_social_accounts account
          on account.id = request.requester_account_id
          and account.ownership_state = 'active'
        join public.profiles profile on profile.id = account.profile_id
        where request.crew_id = manager.crew_id
          and request.state = 'pending'
          and request.expires_at > statement_timestamp()
          and public._social_crew_relationship_between_accounts(
            request.requester_account_id,
            manager.owner_account_id
          ) is distinct from 'blocked'
          and not public._social_crew_admission_ineligible(request.crew_id, request.requester_account_id)
          and not exists (
            select 1
            from public.social_crew_members active_member
            where active_member.crew_id = request.crew_id
              and active_member.social_account_id = request.requester_account_id
              and active_member.state = 'active'
          )
        order by request.created_at, request.id
        limit 50
      ) pending
    ), '[]'::jsonb),
    'hasMore', exists(
      select 1
      from public.social_crew_join_requests request
      join public.private_social_accounts account
        on account.id = request.requester_account_id
        and account.ownership_state = 'active'
      where request.crew_id = manager.crew_id
        and request.state = 'pending'
        and request.expires_at > statement_timestamp()
        and public._social_crew_relationship_between_accounts(
          request.requester_account_id,
          manager.owner_account_id
        ) is distinct from 'blocked'
        and not public._social_crew_admission_ineligible(request.crew_id, request.requester_account_id)
        and not exists (
          select 1
          from public.social_crew_members active_member
          where active_member.crew_id = request.crew_id
            and active_member.social_account_id = request.requester_account_id
            and active_member.state = 'active'
        )
      order by request.created_at, request.id
      offset 50
      limit 1
    )
  )
  from manager;
$$;

create or replace function public.provision_social_product_account(
  p_supabase_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_account public.private_social_accounts%rowtype;
  v_clerk_placeholder text := 'supabase:' || p_supabase_user_id::text;
begin
  if p_supabase_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('supabase:' || p_supabase_user_id::text, 0)
  );

  -- auth.users DELETE holds this row before its triggers run. Taking it before the
  -- profile row keeps one order with deletion, which writes the profile later.
  perform 1 from auth.users where id = p_supabase_user_id for key share;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  select * into v_profile
    from public.profiles
   where user_id = p_supabase_user_id
   limit 1
   for update;

  if not found
     or v_profile.handle is null
     or char_length(trim(v_profile.handle)) = 0 then
    return jsonb_build_object('ok', false, 'code', 'profile_not_claimed');
  end if;

  select * into v_account
    from public.private_social_accounts
   where supabase_user_id = p_supabase_user_id
      or profile_id = v_profile.id
   order by id
   limit 1
   for update;

  if v_account.id is not null then
    if v_account.profile_id <> v_profile.id then
      return jsonb_build_object('ok', false, 'code', 'ownership_conflict');
    end if;
    if v_account.supabase_user_id is not null
       and v_account.supabase_user_id <> p_supabase_user_id then
      return jsonb_build_object('ok', false, 'code', 'ownership_conflict');
    end if;
    if v_account.supabase_user_id is null then
      update public.private_social_accounts
         set supabase_user_id = p_supabase_user_id,
             updated_at = now(),
             ownership_changed_at = now()
       where id = v_account.id;
    end if;
    return jsonb_build_object(
      'ok', true,
      'product_account_id', v_account.id,
      'provisioned', false
    );
  end if;

  insert into public.private_social_accounts (
    clerk_user_id,
    supabase_user_id,
    profile_id
  ) values (
    v_clerk_placeholder,
    p_supabase_user_id,
    v_profile.id
  ) returning * into v_account;

  return jsonb_build_object(
    'ok', true,
    'product_account_id', v_account.id,
    'provisioned', true
  );
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'ownership_conflict');
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
  v_profile public.profiles;
  v_user uuid;
  v_created boolean := false;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_next text;
  v_audit uuid;
begin
  select * into v_staff from public.private_social_staff_roles
  where id = p_staff_role_id and active and revoked_at is null and role = 'moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  if p_action is null or p_action not in ('suspend', 'reinstate') or char_length(v_reason) not between 3 and 500 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if p_report_id is not null and not exists (
    select 1 from public.social_content_reports where id = p_report_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  select user_id into v_user from public.profiles where id = p_profile_id;
  if v_user is not null then
    perform pg_advisory_xact_lock(hashtextextended('supabase:' || v_user::text, 0));
    perform 1 from auth.users where id = v_user for key share;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'gone');
    end if;
  end if;
  perform public._lock_social_participant_accounts(array(
    select account.id from public.private_social_accounts account where account.profile_id = p_profile_id
  ));
  select * into v_profile from public.profiles where id = p_profile_id for update;
  if v_profile.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_profile.user_id is distinct from v_user then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  select * into v_account from public.private_social_accounts
  where profile_id = p_profile_id
  for update;
  if v_account.id is null and p_action = 'suspend' and v_profile.user_id is not null then
    insert into public.private_social_accounts(clerk_user_id, supabase_user_id, profile_id, ownership_state)
    values ('supabase:' || v_profile.user_id::text, v_profile.user_id, v_profile.id, 'suspended')
    returning * into v_account;
    v_created := true;
  end if;
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  -- Account deletion also leaves 'suspended' with no auth user. That account
  -- has gone; it is never reinstated and never suspended a second time.
  if v_account.supabase_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'gone');
  end if;
  v_next := case when p_action = 'suspend' then 'suspended' else 'active' end;
  if not v_created and v_account.ownership_state = v_next then
    return jsonb_build_object('ok', true, 'code', 'unchanged', 'state', v_next);
  end if;
  if not v_created then
    update public.private_social_accounts
    set ownership_state = v_next, ownership_changed_at = now(), updated_at = now()
    where id = v_account.id;
  end if;
  insert into public.social_account_moderation_audit(
    social_account_id, profile_handle, action, reason, staff_role_id, staff_display_name, report_id
  ) values (
    v_account.id, v_profile.handle, p_action, v_reason, v_staff.id, v_staff.display_name, p_report_id
  ) returning id into v_audit;
  return jsonb_build_object('ok', true, 'code', case when p_action = 'suspend' then 'suspended' else 'reinstated' end,
    'state', v_next, 'auditId', v_audit);
end;
$$;

-- Item 7. A repeat, or a member that is not removed, changes nothing.
create table public.social_crew_removal_corrections (
  id uuid primary key default gen_random_uuid(),
  -- The row goes with its crew, and with its subject's auth user, in the same
  -- transaction as that account deletion. Member, account and staff IDs carry no key.
  crew_id uuid not null references public.social_crews(id) on delete cascade,
  subject_user_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid not null,
  social_account_id uuid not null,
  reason text not null check (char_length(reason) between 3 and 500),
  staff_role_id uuid not null,
  staff_display_name text not null check (char_length(staff_display_name) between 1 and 120),
  created_at timestamptz not null default now()
);
create index social_crew_removal_corrections_crew_idx
  on public.social_crew_removal_corrections (crew_id, created_at desc);
create index social_crew_removal_corrections_subject_idx
  on public.social_crew_removal_corrections (subject_user_id);
alter table public.social_crew_removal_corrections enable row level security;
revoke all on table public.social_crew_removal_corrections from public, anon, authenticated, service_role;
grant select, insert on table public.social_crew_removal_corrections to service_role;

create function public.correct_social_crew_removal_admin(
  p_staff_role_id uuid,p_crew_id uuid,p_member_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_staff public.private_social_staff_roles; v_member public.social_crew_members;
  v_reason text:=btrim(coalesce(p_reason,'')); v_audit uuid; v_subject uuid;
begin
  select * into v_staff from public.private_social_staff_roles
  where id=p_staff_role_id and active and revoked_at is null and role='moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  if char_length(v_reason) not between 3 and 500 then
    return jsonb_build_object('ok',false,'code','invalid'); end if;
  perform 1 from public.social_crews where id=p_crew_id for update;
  if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
  select * into v_member from public.social_crew_members
  where id=p_member_id and crew_id=p_crew_id for update;
  if v_member.id is null then return jsonb_build_object('ok',false,'code','not_found'); end if;
  -- The subject's auth row before the account lock, as admission does. A deletion in
  -- flight makes this wait, and then the subject is gone.
  select account.supabase_user_id into v_subject from public.private_social_accounts account
  where account.id=v_member.social_account_id;
  if v_subject is null then return jsonb_build_object('ok',false,'code','gone'); end if;
  perform 1 from auth.users where id=v_subject for key share;
  if not found then return jsonb_build_object('ok',false,'code','gone'); end if;
  perform public._lock_social_participant_accounts(array[v_member.social_account_id]);
  if exists(select 1 from public.private_social_accounts
    where id=v_member.social_account_id and profile_id=v_staff.profile_id) then
    return jsonb_build_object('ok',false,'code','forbidden'); end if;
  if v_member.state<>'removed' then
    return jsonb_build_object('ok',true,'code','unchanged','state',v_member.state); end if;
  update public.social_crew_members set state='left',updated_at=now() where id=v_member.id;
  update public.social_crews set authority_revision=authority_revision+1,updated_at=now() where id=p_crew_id;
  insert into public.social_crew_removal_corrections(
    crew_id,subject_user_id,member_id,social_account_id,reason,staff_role_id,staff_display_name
  ) values (
    p_crew_id,v_subject,v_member.id,v_member.social_account_id,v_reason,v_staff.id,v_staff.display_name
  ) returning id into v_audit;
  return jsonb_build_object('ok',true,'code','corrected','state','left','auditId',v_audit);
end;
$$;

revoke all on function public._lock_social_participant_accounts(uuid[]) from public, anon, authenticated, service_role;
revoke all on function public._social_crew_admission_refused(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public._lock_social_block_participants() from public, anon, authenticated, service_role;
revoke all on function public._social_crew_admission_ineligible(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public._lock_social_auth_user_accounts() from public, anon, authenticated, service_role;
revoke all on function public._purge_social_crew_receipts_on_unbind() from public, anon, authenticated, service_role;
revoke all on function public.correct_social_crew_removal_admin(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.correct_social_crew_removal_admin(uuid,uuid,uuid,text) to service_role;

commit;
