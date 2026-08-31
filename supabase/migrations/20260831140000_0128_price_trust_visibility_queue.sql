-- Price trust visibility queue fence (0128).
-- Captain applies. Agents ship SQL only.
--
-- A moderation hide or restore changes which trust events and account credits
-- may remain visible. Queue that change in the same transaction so an older
-- reconciliation task cannot acknowledge a stale pre-moderation snapshot.

begin;

create or replace function public.queue_community_price_trust_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE'
     and old.drink_category is not null
     and (
       (old.actor is not null and new.actor is null)
       or new.venue_id is distinct from old.venue_id
       or new.drink_category is distinct from old.drink_category
     ) then
    perform *
      from public.enqueue_price_trust_reconciliation(
        old.venue_id,
        old.drink_category
      );
  end if;

  if new.drink_category is not null
     and (
       new.actor is not null
       or (
         tg_op = 'UPDATE'
         and (
           new.hidden_at is distinct from old.hidden_at
           or new.venue_id is distinct from old.venue_id
           or new.drink_category is distinct from old.drink_category
         )
       )
     ) then
    perform *
      from public.enqueue_price_trust_reconciliation(
        new.venue_id,
        new.drink_category
      );
  end if;
  return new;
end;
$$;

revoke all on function public.queue_community_price_trust_reconciliation()
  from public, anon, authenticated;
grant execute on function public.queue_community_price_trust_reconciliation()
  to service_role;

drop trigger if exists community_prices_queue_price_trust
  on public.community_prices;
create trigger community_prices_queue_price_trust
after insert or update of venue_id, drink_category, price_pennies, actor, submitted_at, hidden_at
on public.community_prices
for each row
execute function public.queue_community_price_trust_reconciliation();

-- Reconcile existing price pairs once. This includes legacy hides committed
-- before this trigger watched hidden_at, where the synchronous reversal may
-- have failed after the moderation write was already durable.
insert into public.price_trust_reconciliation_queue as queue (
  venue_id,
  category,
  version,
  enqueued_at
)
select
  pairs.venue_id,
  pairs.category,
  nextval('public.price_trust_reconciliation_version_seq'),
  now()
from (
  select distinct
    btrim(price.venue_id) as venue_id,
    price.drink_category as category
  from public.community_prices as price
  where price.drink_category is not null
    and nullif(btrim(price.venue_id), '') is not null
) as pairs
on conflict on constraint price_trust_reconciliation_queue_pkey do update
  set version = nextval('public.price_trust_reconciliation_version_seq'),
      enqueued_at = excluded.enqueued_at;

commit;
