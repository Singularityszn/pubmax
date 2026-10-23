-- Founding members renumbered (0190): test accounts off the wall, no gaps.
-- Captain / firstmate applies. Agents ship SQL only.
--
-- WHAT WAS WRONG: the wall read 2, 3, 4, 5, 7, 8, 14, 15 ... 19 (captain, 18
-- Oct 2026). Nos. 9-13 belonged to QA accounts that later deleted themselves,
-- No. 6 belonged to a suspended account, and Nos. 18 and 19 were the QA Pub Pal
-- account and the production smoke account (`e2e/prod-smoke/README.md`). Real
-- people sat behind numbers that test traffic had spent.
--
-- WHAT THIS DOES, by captain decision:
--   1. A new flag, `profiles.founding_member_excluded`, marks an account that
--      may never hold a number. The grant refuses it, so a smoke run that
--      re-claims its handle cannot take a number back.
--   2. The flag is set, and the number cleared, on `qa_pubpal_1003`,
--      `pubmaxx_smoke` and `karansdad`.
--   3. Every number on a tombstoned or unowned row is released.
--   4. The numbers left are compacted to 1..N in their existing order, so
--      nobody changes place relative to anybody else.
--
-- This is a ONE-OFF compaction. 0097's rule still holds for every departure
-- after it: a tombstoned founder keeps the number, because renumbering on every
-- deletion would move every later member's mark each time.
--
-- THE WAY BACK: every number this migration moved is written to
-- `pubmax_private.founding_member_renumber_0190` first, and the rollback puts
-- each one back from there.

begin;

-- The renumber runs on the FIRST apply only. The ledger table is the durable
-- marker: once it exists, a re-apply after a later departure must not release
-- that founder's number and shift everybody after them.
create temporary table founding_renumber_0190_first_apply on commit drop as
select to_regclass('pubmax_private.founding_member_renumber_0190') is null as first_apply;

alter table public.profiles
  add column if not exists founding_member_excluded boolean not null default false;

comment on column public.profiles.founding_member_excluded is
  'True for an account that may never hold a founding number (QA, smoke and staff test accounts). Read only by pubmax_private.grant_founding_member_number. Grants and withholds no capability.';

-- ── The ledger the rollback reads ───────────────────────────────────────────
create table if not exists pubmax_private.founding_member_renumber_0190 (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  old_number integer not null,
  new_number integer
);

comment on table pubmax_private.founding_member_renumber_0190 is
  'The founding number each profile held before migration 0190 renumbered the wall, and the number it holds after (null when released). Read only by the 0190 rollback. No client role may read or write it.';

alter table pubmax_private.founding_member_renumber_0190 enable row level security;
revoke all on table pubmax_private.founding_member_renumber_0190 from public;
revoke all on table pubmax_private.founding_member_renumber_0190 from anon;
revoke all on table pubmax_private.founding_member_renumber_0190 from authenticated;

-- ── The grant, now refusing an excluded account ─────────────────────────────
-- 0097's body with one predicate added to the eligibility check.
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

  perform pg_advisory_xact_lock(hashtextextended('pubmax:founding_member_number', 0));

  select founding_member_number into v_existing
    from public.profiles
   where id = p_profile_id;
  if v_existing is not null then
    return v_existing;
  end if;

  -- Only a claimed, live handle that is not a test account is owed a number.
  if not exists (
    select 1 from public.profiles
     where id = p_profile_id
       and user_id is not null
       and tombstoned_at is null
       and founding_member_excluded = false
  ) then
    return null;
  end if;

  select count(*), coalesce(max(founding_member_number), 0)
    into v_taken, v_highest
    from public.profiles
   where founding_member_number is not null;

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

-- ── The renumber ────────────────────────────────────────────────────────────
-- The grant's own lock, so no claim takes a number while the wall moves.
select pg_advisory_xact_lock(hashtextextended('pubmax:founding_member_number', 0));

update public.profiles
   set founding_member_excluded = true
 where lower(handle) in ('qa_pubpal_1003', 'pubmaxx_smoke', 'karansdad')
   and founding_member_excluded = false;

-- Who keeps a number, and which one, in the order they already stand.
create temporary table founding_renumber_0190 on commit drop as
select
  id,
  founding_member_number as old_number,
  case
    when founding_member_excluded or tombstoned_at is not null or user_id is null
      then null
    else row_number() over (
      partition by (founding_member_excluded or tombstoned_at is not null or user_id is null)
      order by founding_member_number asc
    )::integer
  end as new_number
from public.profiles
where founding_member_number is not null
  and (select first_apply from founding_renumber_0190_first_apply);

-- Write the way back first. On a re-apply the work table is empty, so the
-- ledger and every number stay as the first apply left them.
insert into pubmax_private.founding_member_renumber_0190 (profile_id, old_number, new_number)
select id, old_number, new_number
  from founding_renumber_0190
 where new_number is distinct from old_number
on conflict (profile_id) do nothing;

-- Clear, then set: the unique index is checked row by row, so moving 14 to 8
-- in place could collide with a row that has not moved yet.
update public.profiles p
   set founding_member_number = null,
       updated_at = now()
  from founding_renumber_0190 r
 where p.id = r.id
   and r.new_number is distinct from r.old_number;

update public.profiles p
   set founding_member_number = r.new_number,
       updated_at = now()
  from founding_renumber_0190 r
 where p.id = r.id
   and r.new_number is not null
   and r.new_number is distinct from r.old_number;

commit;
