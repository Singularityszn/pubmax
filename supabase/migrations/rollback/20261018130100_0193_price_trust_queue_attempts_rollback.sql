-- Rollback 0193: remove queue attempts and the dead letter.
--
-- What it costs: every attempt count and every dead-letter stamp is dropped.
-- A dead-lettered pair becomes live work again, and a pair that keeps failing
-- goes back on the queue with no count, which is the 0126 behaviour. The
-- reconcile cron can then answer 503 on every run again. Roll the app back
-- first or at the same time: the app falls back to 0126 behaviour when the
-- columns and the function are absent.
--
-- Trust events, credits and queue rows themselves are kept.

begin;

drop function if exists public.record_price_trust_reconciliation_failure(text, text, bigint, integer);

-- Restore the 0126 body of the enqueue function, which names no new column.
create or replace function public.enqueue_price_trust_reconciliation(
  p_venue_id text,
  p_category text
)
returns table (
  venue_id text,
  category text,
  version bigint,
  enqueued_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if nullif(btrim(p_venue_id), '') is null
     or p_category is null
     or p_category not in (
       'beer', 'wine', 'whisky', 'gin', 'vodka', 'rum',
       'cocktail', 'shot', 'alcohol-free', 'soft-drink', 'coffee', 'other'
     ) then
    return;
  end if;

  return query
  insert into public.price_trust_reconciliation_queue as queue (
    venue_id,
    category,
    version,
    enqueued_at
  )
  values (
    btrim(p_venue_id),
    p_category,
    nextval('public.price_trust_reconciliation_version_seq'),
    now()
  )
  on conflict on constraint price_trust_reconciliation_queue_pkey do update
    set version = nextval('public.price_trust_reconciliation_version_seq'),
        enqueued_at = excluded.enqueued_at
  returning queue.venue_id, queue.category, queue.version, queue.enqueued_at;
end;
$$;

revoke all on function public.enqueue_price_trust_reconciliation(text, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_price_trust_reconciliation(text, text)
  to service_role;

drop index if exists public.price_trust_reconciliation_queue_live_idx;

alter table public.price_trust_reconciliation_queue
  drop constraint if exists price_trust_reconciliation_queue_attempts_check;
alter table public.price_trust_reconciliation_queue
  drop column if exists dead_lettered_at,
  drop column if exists attempts;

commit;
