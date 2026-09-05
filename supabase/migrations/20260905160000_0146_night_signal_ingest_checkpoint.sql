-- 0146: the Night Signal sweep's own checkpoint.
--
-- The candidates themselves live in public.night_signal_claims (0034), which
-- already carries the three review states, the source, the corroborating
-- evidence and the timestamps. This table carries only the OPERATIONAL state
-- the scheduled sweep needs to be safe to fail and safe to retry: one lease per
-- scope, the queries owed a bounded retry, and the ones the attempt cap
-- refused, in the shape city_enrichment_progress (0142) set.
--
-- It is not a signal lane: it holds no claim, no source and no publisher, so a
-- fact can never reach a reader through this table.
--
-- Client roles get NOTHING here. The row carries provider error text and the
-- shape of our own spend, and the service role is the only writer.

begin;

create table if not exists public.night_signal_ingest_checkpoint (
  scope text primary key check (char_length(btrim(scope)) between 1 and 60),
  version integer not null default 1 check (version >= 1),
  deferred jsonb not null default '[]'::jsonb check (jsonb_typeof(deferred) = 'array'),
  terminal jsonb not null default '[]'::jsonb check (jsonb_typeof(terminal) = 'array'),
  lease_owner text check (lease_owner is null or char_length(btrim(lease_owner)) between 1 and 120),
  lease_expires_at timestamptz,
  last_run jsonb check (last_run is null or jsonb_typeof(last_run) = 'object'),
  updated_at timestamptz not null default now(),
  -- A lease is both halves or neither: an owner with no expiry never expires,
  -- and an expiry with no owner blocks a claim nobody holds.
  check ((lease_owner is null) = (lease_expires_at is null))
);

-- The claim is a conditional UPDATE matching a null or expired lease.
create index if not exists night_signal_ingest_checkpoint_lease_idx
  on public.night_signal_ingest_checkpoint (lease_expires_at);

alter table public.night_signal_ingest_checkpoint enable row level security;

revoke all on table public.night_signal_ingest_checkpoint from public, anon, authenticated;
grant select, insert, update, delete on table public.night_signal_ingest_checkpoint to service_role;

drop policy if exists night_signal_ingest_checkpoint_client_deny
  on public.night_signal_ingest_checkpoint;
create policy night_signal_ingest_checkpoint_client_deny
  on public.night_signal_ingest_checkpoint
  for all to anon, authenticated
  using (false) with check (false);

commit;
