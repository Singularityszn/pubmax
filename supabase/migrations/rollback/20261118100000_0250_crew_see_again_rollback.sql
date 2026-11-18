-- Rollback 0250 destroys all private directions and pair tombstones/outcomes.
-- No data can be recovered. Stop application choice writers first. A non-empty
-- store requires pubmax.see_again_discarded equal to the combined exact row count.
begin;
lock table auth.users in share row exclusive mode;
lock table public.private_social_accounts,public.social_blocks,public.social_mutes,
  public.social_crews,public.social_crew_members,public.social_crew_attendance,
  public.private_account_identities,public.adult_self_assertions,
  public.social_crew_see_again_pairs,public.social_crew_see_again_choices in share row exclusive mode nowait;
do $$
declare total bigint;
begin
  select (select count(*) from public.social_crew_see_again_pairs)+(select count(*) from public.social_crew_see_again_choices) into total;
  if total>0 and current_setting('pubmax.see_again_discarded',true) is distinct from total::text then
    raise exception '0250 rollback destroys % private records. Set pubmax.see_again_discarded to that exact count.',total;
  end if;
end;
$$;
drop trigger see_again_lock_account on public.private_social_accounts;
drop trigger see_again_account_invalidated on public.private_social_accounts;
drop trigger see_again_block_invalidated on public.social_blocks;
drop trigger see_again_mute_lock on public.social_mutes;
drop trigger see_again_mute_invalidated on public.social_mutes;
drop trigger see_again_attendance_invalidated on public.social_crew_attendance;
drop trigger see_again_member_invalidated on public.social_crew_members;
drop function public.write_social_crew_see_again(uuid,uuid,uuid,uuid,text,text,boolean);
drop function public.read_social_crew_see_again(uuid,uuid,uuid);
drop function public.export_social_crew_see_again(uuid,integer);
drop function public.purge_expired_social_crew_see_again(integer);
drop function public._see_again_safety_trigger();
drop function public._see_again_lock_account_write();
drop function public._see_again_lock_mute();
drop function public._see_again_invalidate(uuid,uuid,uuid);
drop function public._see_again_lock_roster(uuid);
drop function public._see_again_allowed(uuid,uuid,uuid);
drop function public._see_again_participant(uuid,uuid);
drop function public._see_again_adult(uuid);
drop function public._see_again_pair_lock(uuid,uuid);
drop function public._see_again_next(text,text);
drop table public.social_crew_see_again_choices;
drop table public.social_crew_see_again_pairs;
commit;
