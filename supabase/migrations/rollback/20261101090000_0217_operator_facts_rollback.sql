-- Rollback 0217: drop the operator facts table. THIS TAKES EVERY PUBLISHED
-- "FROM THE PUB" WORD OFF THE VENUE SHEET AND OFF TONIGHT, and every
-- withdrawal stamp with it. The proposals in 0048 keep their accepted status,
-- so nothing about the review is lost: once 0217 is applied again, a
-- moderator re-accepts a proposal to publish it again.
--
-- No pack, pin, price band or order moves, because nothing of that kind
-- reads this table. The app answers 503 on an accept while the table is
-- absent in production, rather than claiming a publish it cannot keep.

begin;

drop policy if exists operator_facts_published_read on public.operator_facts;

drop index if exists public.operator_facts_on_date_published_idx;
drop index if exists public.operator_facts_venue_published_idx;

drop table if exists public.operator_facts;

commit;
