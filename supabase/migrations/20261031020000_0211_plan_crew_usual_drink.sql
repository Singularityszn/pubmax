-- A crew member's usual drink on a Plan, for the round forecast (review item B6).
--
-- What was asked, on the launch review of 30 Oct 2026: "What will a round cost
-- us at each stop?" On a locked plan each member picks a usual drink once, from
-- four closed choices, and the plan card prints the round at each stop from the
-- prices the pub lists. lib/planUsualDrink.ts owns the set and the words; this
-- column is where a member's pick lands.
--
-- WHAT IT IS NOT. It is a forecast input. No payment, settlement or per-person
-- split reads it, and nothing in the product branches on it beyond printing
-- that forecast.
--
-- ADDITIVE AND NULLABLE. Null is "has not picked", and the forecast stays off
-- until at least one member picks. No row is backfilled, because a usual drink
-- nobody chose is a guess about a person.
--
-- NO GRANT MOVES. The app reads and writes this column on the service role
-- (lib/planStore.ts, POST /api/plans/[id]/usual-drink, found by the member's
-- own token hash). 0172 grants `authenticated` a COLUMN list on this table for
-- the crew realtime signal, and this column is deliberately not added to it: a
-- signal carries no row, and a browser role has no reason to read another
-- member's drink off the table.

alter table public.plan_crew_members
  add column if not exists usual_drink text;

comment on column public.plan_crew_members.usual_drink is
  'The member''s usual drink for the round forecast: beer, wine, alcohol_free or soft. Null until they pick. Owned by lib/planUsualDrink.ts.';

do $$
begin
  -- The closed set, mirrored from PLAN_USUAL_DRINKS in lib/planUsualDrink.ts.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.plan_crew_members'::regclass
       and conname = 'plan_crew_members_usual_drink_known'
  ) then
    alter table public.plan_crew_members
      add constraint plan_crew_members_usual_drink_known
      check (usual_drink is null or usual_drink in ('beer', 'wine', 'alcohol_free', 'soft'));
  end if;
end
$$;
