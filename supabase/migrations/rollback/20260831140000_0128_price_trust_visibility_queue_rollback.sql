-- Roll back price trust visibility queue fence (0128).

begin;

create or replace function public.queue_community_price_trust_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE'
     and old.actor is not null
     and old.drink_category is not null
     and (
       new.actor is null
       or new.venue_id is distinct from old.venue_id
       or new.drink_category is distinct from old.drink_category
     ) then
    perform *
      from public.enqueue_price_trust_reconciliation(
        old.venue_id,
        old.drink_category
      );
  end if;

  if new.actor is not null and new.drink_category is not null then
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
after insert or update of venue_id, drink_category, price_pennies, actor, submitted_at
on public.community_prices
for each row
execute function public.queue_community_price_trust_reconciliation();

commit;
