-- A removed Plan member loses the table door too.
--
-- 0070 moved every RLS helper into pubmax_private, and every policy on
-- public.plans, public.plan_stops and public.plan_crew_members reads
-- pubmax_private.rls_is_plan_participant (0075 last wrote that body). 0124 then
-- added membership_revoked_at and re-declared the helper WITH the revoked check,
-- but in public: a second function that no policy calls. So the effective
-- participant test never learned about revocation, and an account whose seat the
-- host removed kept SELECT on the Plan row, its stops and its crew through
-- PostgREST for as long as its user_id stayed on the revoked row. The API door
-- was closed (planMemberIdentityResult filters on the column); this closes the
-- second line to match. Found by __tests__/permissionMatrixEffective.test.ts.
--
-- ONE body, in the schema the policies read. The stray public copy is dropped
-- because it was also an exposed RPC in PostgREST's public schema, which is
-- exactly what 0070 moved the helpers out of.

begin;

create or replace function pubmax_private.rls_is_plan_participant(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_plan_id is not null
    and (select auth.uid()) is not null
    and exists (
      select 1
      from public.plans pl
      where pl.id = p_plan_id
        and pl.social_owner_account_id is null
        and (
          pl.owner_user_id = (select auth.uid())
          or exists (
            select 1
            from public.plan_crew_members m
            where m.plan_id = p_plan_id
              and m.user_id = (select auth.uid())
              and m.membership_revoked_at is null
          )
        )
    );
$$;

drop function if exists public.rls_is_plan_participant(uuid);

commit;
