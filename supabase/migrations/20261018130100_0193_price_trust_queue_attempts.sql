-- Price trust reconciliation queue: attempts and a dead letter (0193).
-- Captain applies. Agents ship SQL only. Rollback beside this file.
--
-- Before 0193 a pair the worker could not reconcile went back on the queue
-- with no count, forever. The reconcile cron then answered 503 on every run,
-- so a new failure looked the same as an old one and nobody heard it.
--
-- 0193 adds three things.
--   1. `attempts`: the failed worker runs since the last price write for the
--      pair. Default 0, so every row already queued starts with a full budget.
--   2. `dead_lettered_at`: set when `attempts` reaches the cap the app sends.
--      The worker no longer lists such a row. The row stays, so an operator
--      can read it.
--   3. `record_price_trust_reconciliation_failure`: the worker's one way to
--      count a failure. It is bound to the queue version the worker read, so
--      a failure never lands on newer work.
--
-- A new price write for the pair (the 0126 trigger and the app's direct
-- enqueue both call `enqueue_price_trust_reconciliation`) is new evidence, so
-- that function now sets `attempts` back to 0 and clears `dead_lettered_at`.
--
-- Additive rollout: an app deployed before this migration never names the new
-- columns or the new function, and the app falls back to the 0126 behaviour
-- when they are absent.
--
-- RLS: unchanged. Service-role only, as in 0126.

begin;

alter table public.price_trust_reconciliation_queue
  add column if not exists attempts integer not null default 0,
  add column if not exists dead_lettered_at timestamptz;

alter table public.price_trust_reconciliation_queue
  drop constraint if exists price_trust_reconciliation_queue_attempts_check;
alter table public.price_trust_reconciliation_queue
  add constraint price_trust_reconciliation_queue_attempts_check
    check (attempts >= 0);

comment on column public.price_trust_reconciliation_queue.attempts is
  'Failed worker runs since the last price write for this pair. A price write sets it to 0.';
comment on column public.price_trust_reconciliation_queue.dead_lettered_at is
  'Set when attempts reached the app cap. The worker skips the row until a new price write.';

-- The worker reads live rows in queue order. A dead-lettered row is not work.
create index if not exists price_trust_reconciliation_queue_live_idx
  on public.price_trust_reconciliation_queue (enqueued_at, venue_id, category)
  where dead_lettered_at is null;

-- Same signature and same answer as 0126. The one change: a new write for the
-- pair starts a fresh attempt budget.
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
    enqueued_at,
    attempts,
    dead_lettered_at
  )
  values (
    btrim(p_venue_id),
    p_category,
    nextval('public.price_trust_reconciliation_version_seq'),
    now(),
    0,
    null
  )
  on conflict on constraint price_trust_reconciliation_queue_pkey do update
    set version = nextval('public.price_trust_reconciliation_version_seq'),
        enqueued_at = excluded.enqueued_at,
        attempts = 0,
        dead_lettered_at = null
  returning queue.venue_id, queue.category, queue.version, queue.enqueued_at;
end;
$$;

revoke all on function public.enqueue_price_trust_reconciliation(text, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_price_trust_reconciliation(text, text)
  to service_role;

-- Count one failed worker run for the exact version the worker read.
-- It moves the row to the back of the queue (enqueued_at = now()), so one bad
-- pair cannot hold the head of every batch. The version does not move, so a
-- direct sync that holds the same version can still acknowledge it.
-- At the cap it stamps dead_lettered_at. No row comes back when the version
-- moved on, the row is gone, or the row is already dead-lettered.
create or replace function public.record_price_trust_reconciliation_failure(
  p_venue_id text,
  p_category text,
  p_version bigint,
  p_max_attempts integer
)
returns table (
  attempts integer,
  dead_lettered boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if nullif(btrim(p_venue_id), '') is null
     or p_category is null
     or p_version is null
     or p_max_attempts is null
     or p_max_attempts < 1 then
    return;
  end if;

  return query
  update public.price_trust_reconciliation_queue as queue
     set attempts = queue.attempts + 1,
         enqueued_at = now(),
         dead_lettered_at = case
           when queue.attempts + 1 >= p_max_attempts then now()
           else null
         end
   where queue.venue_id = btrim(p_venue_id)
     and queue.category = p_category
     and queue.version = p_version
     and queue.dead_lettered_at is null
  returning queue.attempts, queue.dead_lettered_at is not null;
end;
$$;

revoke all on function public.record_price_trust_reconciliation_failure(text, text, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.record_price_trust_reconciliation_failure(text, text, bigint, integer)
  to service_role;

commit;
