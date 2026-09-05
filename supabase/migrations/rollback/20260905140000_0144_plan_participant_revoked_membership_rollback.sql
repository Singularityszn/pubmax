-- Rollback of 0144. Restores the 0075 helper body (no revoked-membership check)
-- in pubmax_private and the 0124 public copy, so the catalog reads as it did
-- before 0144. Rolling back re-opens the table door for removed members; the
-- API door stays closed either way.

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
          )
        )
    );
$$;

create or replace function public.rls_is_plan_participant(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_plan_id is not null
    and (select auth.uid()) is not null
    and (
      exists (
        select 1
        from public.plans pl
        where pl.id = p_plan_id
          and pl.owner_user_id = (select auth.uid())
      )
      or exists (
        select 1
        from public.plan_crew_members m
        where m.plan_id = p_plan_id
          and m.user_id = (select auth.uid())
          and m.membership_revoked_at is null
      )
    );
$$;

commit;
