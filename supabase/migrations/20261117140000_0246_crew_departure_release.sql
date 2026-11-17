-- 0246: a deleted account frees its guest places and cancels the nights it owns.
-- The captain's rule: free their guest places, cancel nights they own, keep history.
--
-- 1. A departed account is one account deletion finished: unbound, with its profile
--    tombstoned. Suspended accounts and unbound legacy accounts are not departed.
-- 2. _release_departed_crew_places(crew) works under that crew's row lock. A departed
--    guest's active member row becomes 'left', the leave transition, so the existing
--    trigger revokes the seat and their pending invitations. A departed owner's
--    crew-bound Plan becomes 'abandoned' under the existing status rule, and the crew's
--    pending requests and invitations become 'expired'. The authority revision moves
--    once. Rows stay as history. A second run changes nothing.
-- 3. Account deletion cannot do this itself: it holds the auth row and account locks,
--    and admission takes the crew row before those, so a crew lock there could close
--    a cycle. So the release runs after the deletion commits, in its own transaction:
--    - release_departed_social_crew_places(limit) sweeps up to that many crews with a
--      departed member still holding a place or owning an open night. The deletion
--      service calls it after every completed or repeated account deletion, and an
--      operator can call it (docs/CREW_REMOVAL_CORRECTION_RUNBOOK.md).
--    - Every admission and invitation first releases its own crew's departed members,
--      so a place is never kept from a new guest, and refuses when the night is
--      cancelled.
--    Lock order: crew row, member rows, Plan row, seat and invitation rows. It takes no
--    auth row and no account lock.
-- 4. Rollback drops both functions and restores 0245's _social_crew_admission_refused.
--    Places already freed and nights already cancelled stay as they are.
begin;

create function public._release_departed_crew_places(p_crew uuid)
returns integer language plpgsql security definer set search_path=''
as $$
declare v_member record; v_changed integer := 0;
begin
  perform 1 from public.social_crews where id=p_crew for update;
  if not found then return 0; end if;
  for v_member in
    select member.id, member.role, crew.plan_id
    from public.social_crew_members member
    join public.social_crews crew on crew.id=member.crew_id
    join public.private_social_accounts account on account.id=member.social_account_id
    join public.profiles profile on profile.id=account.profile_id
    where member.crew_id=p_crew and member.state='active'
      and account.supabase_user_id is null and profile.tombstoned_at is not null
    order by member.id
    for update of member
  loop
    if v_member.role<>'owner' then
      update public.social_crew_members set state='left',ended_at=now(),updated_at=now() where id=v_member.id;
      v_changed:=v_changed+1;
    else
      update public.plans set status='abandoned'
      where id=v_member.plan_id and status in ('draft','ready','active','ending');
      if found then
        update public.social_crew_join_requests set state='expired',decided_at=now()
        where crew_id=p_crew and state='pending';
        update public.social_crew_invitations set state='expired',decided_at=now()
        where crew_id=p_crew and state='pending';
        v_changed:=v_changed+1;
      end if;
    end if;
  end loop;
  if v_changed>0 then
    update public.social_crews set authority_revision=authority_revision+1,updated_at=now() where id=p_crew;
  end if;
  return v_changed;
end;
$$;

create function public.release_departed_social_crew_places(p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_crew uuid; v_crews integer := 0; v_changed integer := 0;
begin
  for v_crew in
    select distinct member.crew_id
    from public.social_crew_members member
    join public.social_crews crew on crew.id=member.crew_id
    join public.plans plan on plan.id=crew.plan_id
    join public.private_social_accounts account on account.id=member.social_account_id
    join public.profiles profile on profile.id=account.profile_id
    where member.state='active' and account.supabase_user_id is null and profile.tombstoned_at is not null
      and (member.role<>'owner' or plan.status in ('draft','ready','active','ending'))
    order by member.crew_id
    limit greatest(1,least(coalesce(p_limit,20),100))
  loop
    v_changed:=v_changed+public._release_departed_crew_places(v_crew);
    v_crews:=v_crews+1;
  end loop;
  return jsonb_build_object('ok',true,'crews',v_crews,'released',v_changed);
end;
$$;

create or replace function public._social_crew_admission_refused(p_crew uuid,p_account uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
begin
  -- 0246: free this crew's departed members first, under the crew row the caller holds.
  perform public._release_departed_crew_places(p_crew);
  if exists(select 1 from public.social_crews crew join public.plans plan on plan.id=crew.plan_id
    where crew.id=p_crew and plan.status='abandoned') then return true; end if;
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

revoke all on function public._release_departed_crew_places(uuid) from public, anon, authenticated, service_role;
revoke all on function public.release_departed_social_crew_places(integer) from public, anon, authenticated;
grant execute on function public.release_departed_social_crew_places(integer) to service_role;

commit;
