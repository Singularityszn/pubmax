-- Rollback 0248: a block between accepted members stops opening moderator cases.
-- It drops social_crew_block_cases, its triggers and its functions.
--
-- THIS DELETES MODERATOR CASES. Every case, open or decided, with its moderator, reason
-- and decision, is gone and cannot be restored. A removal a moderator decided stays: the
-- member row keeps 'removed', and correct_social_crew_removal_admin (0245) still lifts it.
-- Before anything else the rollback locks the table against writers, without waiting,
-- and counts the rows. When it is busy it stops with "could not obtain lock"; run it
-- again. When there are rows, export what must be kept, then set
-- pubmax.crew_block_cases_discarded to that exact count and run it again.
begin;

do $$
declare v_rows bigint := 0;
begin
  if to_regclass('public.social_crew_block_cases') is not null then
    -- Held until commit, so the count cannot change before the drop.
    lock table public.social_crew_block_cases in access exclusive mode nowait;
    select count(*) into v_rows from public.social_crew_block_cases;
  end if;
  if v_rows > 0
    and coalesce(current_setting('pubmax.crew_block_cases_discarded', true), '') <> v_rows::text then
    raise exception 'Rollback 0248 would drop % crew block cases. Export what must be kept, then set pubmax.crew_block_cases_discarded to that count and run it again.', v_rows;
  end if;
end;
$$;

drop trigger if exists social_blocks_open_crew_cases on public.social_blocks;
drop trigger if exists social_account_unbind_deletes_crew_block_cases on public.private_social_accounts;
drop trigger if exists social_crews_delete_block_cases on public.social_crews;
drop function if exists public.purge_expired_social_crew_block_cases(integer);
drop function if exists public.decide_social_crew_block_case_admin(uuid,uuid,text,uuid,text);
drop function if exists public.read_social_crew_block_cases_admin(uuid,integer);
drop function if exists public._social_crew_block_case_moderator_conflicted(uuid,uuid);
drop function if exists public._delete_social_crew_block_cases_with_crew();
drop function if exists public._delete_social_crew_block_cases_on_unbind();
drop function if exists public._open_social_crew_block_cases();
drop function if exists public._open_social_crew_block_cases_for(uuid,uuid);
drop table if exists public.social_crew_block_cases;

commit;
