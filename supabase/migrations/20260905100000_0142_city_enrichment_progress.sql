-- City enrichment progress (0142): the nightly enrichment cron's checkpoint.
-- Captain / firstmate applies. Agents ship SQL only.
--
-- WHY: production answered 502 on 2026-09-05 03:15:13 when one Exa search
-- timed out during Birmingham enrichment. The run had no durable state at all:
-- the start index was a pure function of the calendar day, so the venue that
-- failed was neither retried nor recorded, and the rest of that night's query
-- budget went unspent. A Vercel function cannot write files, so the checkpoint
-- the local CLI keeps under .data/ has to live here instead.
--
-- WHAT IT IS NOT: a price lane. This row holds operational state only - a
-- cursor, the venues owed a retry, the venues that were refused, and one
-- summary of the last run. No price, no page and no observation is stored
-- here, so nothing on this table can ever reach a pin, a bucket or the Pint
-- Index. Prices still travel the reviewed lanes they always did.

begin;

create table if not exists public.city_enrichment_progress (
  city              text primary key,
  version           integer not null default 1,
  total_pubs        integer not null default 0,
  next_index        integer not null default 0,
  passes            integer not null default 0,
  deferred          jsonb not null default '[]'::jsonb,
  terminal          jsonb not null default '[]'::jsonb,
  lease_owner       text,
  lease_expires_at  timestamptz,
  last_run          jsonb,
  updated_at        timestamptz not null default now()
);

comment on table public.city_enrichment_progress is
  'Nightly city enrichment checkpoint: coverage cursor, venues owed a bounded retry, venues refused after the attempt cap, and one summary of the last run. Operational state only, never a price lane.';

comment on column public.city_enrichment_progress.next_index is
  'An ADVANCEMENT, not a retry position: it only ever moves past a venue whose outcome was recorded. A venue whose search failed is recorded in the deferred list instead.';

comment on column public.city_enrichment_progress.lease_expires_at is
  'A run that crashes holds nothing for long: the claim is a conditional UPDATE that matches only a null or expired lease.';

-- The lease claim is one conditional UPDATE, so this index is what keeps a
-- second scheduler from having to scan to find out it may not run.
create index if not exists city_enrichment_progress_lease_idx
  on public.city_enrichment_progress (lease_expires_at);

alter table public.city_enrichment_progress enable row level security;

-- Nothing here is for a browser. The row carries provider error text and the
-- operational shape of our own spend, and it is read by the moderator surface
-- through the service role alone.
revoke all on table public.city_enrichment_progress from public, anon, authenticated;
grant select, insert, update, delete on table public.city_enrichment_progress to service_role;

drop policy if exists city_enrichment_progress_client_deny on public.city_enrichment_progress;
create policy city_enrichment_progress_client_deny
  on public.city_enrichment_progress for all to anon, authenticated
  using (false) with check (false);

commit;
