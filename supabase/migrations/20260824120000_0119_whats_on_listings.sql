-- Official-API What's-On cache (0119): durable rows the Vercel cron writes.
-- Captain / firstmate applies. Agents ship SQL only.
--
-- WHAT A ROW IS: one What's-On listing persisted from Ticketmaster or Skiddle
-- (kind=event today; quiz/deal/music/sport stay available for a later harvest
-- write). It is NOT a committed public/data/whats_on file. The serverless
-- filesystem is read-only, so this table is the only place a scheduled
-- function can keep events fresh.
--
-- RLS: service-role only. The browser never reads or writes this table.
-- GET /api/cron/refresh-whats-on writes; loadServedWhatsOnListings reads.

begin;

create table if not exists public.whats_on_listings (
  id text primary key,
  kind text not null,
  payload jsonb not null,
  observed_at timestamptz not null,
  generated_at timestamptz not null,
  city text not null default 'london'
);

comment on table public.whats_on_listings is
  'Durable Whats-On listings from official APIs. Readers prefer this store and fall back to bundled files.';
comment on column public.whats_on_listings.kind is
  'sport | quiz | deal | music | event. Cron refresh writes event.';
comment on column public.whats_on_listings.payload is
  'WhatsOnRow JSON. Expired rows are dropped on read and on write.';
comment on column public.whats_on_listings.city is
  'City the listing was fetched for. Default london.';

alter table public.whats_on_listings
  drop constraint if exists whats_on_listings_kind_check;
alter table public.whats_on_listings
  add constraint whats_on_listings_kind_check
  check (kind in ('sport', 'quiz', 'deal', 'music', 'event'));

create index if not exists whats_on_listings_kind_idx
  on public.whats_on_listings (kind);

alter table public.whats_on_listings enable row level security;

revoke all on table public.whats_on_listings from public, anon, authenticated;
grant select, insert, update, delete on table public.whats_on_listings to service_role;

drop policy if exists whats_on_listings_anon_deny on public.whats_on_listings;
create policy whats_on_listings_anon_deny
  on public.whats_on_listings for all to anon
  using (false) with check (false);

drop policy if exists whats_on_listings_authenticated_deny on public.whats_on_listings;
create policy whats_on_listings_authenticated_deny
  on public.whats_on_listings for all to authenticated
  using (false) with check (false);

commit;
