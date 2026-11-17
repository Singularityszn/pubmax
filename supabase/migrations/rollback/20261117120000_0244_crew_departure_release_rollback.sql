-- Rollback 0244: deleted accounts' crew places stop being released. It restores 0243's
-- _social_crew_admission_refused and drops both release functions. Places already freed
-- and nights already cancelled stay as they are; this rollback cannot restore them.
begin;

create or replace function public._social_crew_admission_refused(p_crew uuid,p_account uuid)
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

drop function if exists public.release_departed_social_crew_places(integer);
drop function if exists public._release_departed_crew_places(uuid);

commit;
