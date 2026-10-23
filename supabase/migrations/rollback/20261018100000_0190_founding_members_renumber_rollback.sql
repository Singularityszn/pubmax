-- Rollback 0190: put every founding number back where it was, restore 0097's
-- grant, and drop the exclusion flag.
--
-- WHAT IT COSTS: the wall shows the gaps again, and the QA Pub Pal account,
-- the production smoke account and the suspended account hold their old numbers
-- again. A profile that claimed a handle after 0190 and took a number that a
-- restored row also wants is cleared rather than duplicated, and the restored
-- row wins, because it held the number first. Such a profile then has no
-- number until its next re-claim grants the next free one. Read
-- `founding_member_renumber_0190` before running this if any claim has landed
-- since 0190.

begin;

select pg_advisory_xact_lock(hashtextextended('pubmax:founding_member_number', 0));

-- Clear every number a restore will write, wherever it now sits.
update public.profiles p
   set founding_member_number = null,
       updated_at = now()
 where p.founding_member_number in (
         select old_number from pubmax_private.founding_member_renumber_0190
       )
    or p.id in (
         select profile_id from pubmax_private.founding_member_renumber_0190
       );

update public.profiles p
   set founding_member_number = r.old_number,
       updated_at = now()
  from pubmax_private.founding_member_renumber_0190 r
 where p.id = r.profile_id;

drop table if exists pubmax_private.founding_member_renumber_0190;

-- 0097's grant, exactly.
create or replace function pubmax_private.grant_founding_member_number(
  p_profile_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pubmax_private, public
as $$
declare
  v_existing integer;
  v_taken integer;
  v_highest integer;
begin
  if p_profile_id is null then
    return null;
  end if;

  -- ONE key for the whole cohort, held to the end of the transaction. Every
  -- concurrent claim queues here, so the count each one reads is already the
  -- count after every earlier grant committed.
  perform pg_advisory_xact_lock(hashtextextended('pubmax:founding_member_number', 0));

  select founding_member_number into v_existing
    from public.profiles
   where id = p_profile_id;
  if v_existing is not null then
    return v_existing;
  end if;

  -- Only a claimed, live handle is owed a number. An unowned legacy row and a
  -- tombstoned account are both outside the cohort.
  if not exists (
    select 1 from public.profiles
     where id = p_profile_id
       and user_id is not null
       and tombstoned_at is null
  ) then
    return null;
  end if;

  select count(*), coalesce(max(founding_member_number), 0)
    into v_taken, v_highest
    from public.profiles
   where founding_member_number is not null;

  -- Both guards, because they answer different questions: the count says the
  -- cohort is full, the highest says the next number would be out of range if a
  -- gap were ever introduced by hand.
  if v_taken >= 100 or v_highest >= 100 then
    return null;
  end if;

  update public.profiles
     set founding_member_number = v_highest + 1,
         updated_at = now()
   where id = p_profile_id;

  return v_highest + 1;
end;
$$;

revoke all on function pubmax_private.grant_founding_member_number(uuid)
  from public, anon, authenticated;
grant execute on function pubmax_private.grant_founding_member_number(uuid)
  to service_role;

alter table public.profiles
  drop column if exists founding_member_excluded;

commit;
