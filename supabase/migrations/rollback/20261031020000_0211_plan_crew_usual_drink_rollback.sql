-- Rollback of 0211. Drops the usual drink column and every pick in it.
--
-- What it costs. Every crew member's usual drink is lost, so the round
-- forecast on every plan card goes back to off until the column returns and
-- the members pick again. Nothing else on a plan, a seat or a price is
-- touched. It is a lost choice, never a disclosure: no grant moved in 0211.
-- Deploy the application first if it still selects the column: the crew read
-- falls back on a missing column (42703), so a deploy that runs ahead of this
-- rollback is safe too.

alter table public.plan_crew_members
  drop constraint if exists plan_crew_members_usual_drink_known;

alter table public.plan_crew_members
  drop column if exists usual_drink;
