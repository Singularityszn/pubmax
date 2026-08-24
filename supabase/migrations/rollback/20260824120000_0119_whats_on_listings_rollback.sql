-- Rollback 0119: drop the official-API What's-On cache.
--
-- Lossy by design: persisted listings go with the table. Readers fall back to
-- the bundled public/data/whats_on files.

begin;

drop policy if exists whats_on_listings_authenticated_deny on public.whats_on_listings;
drop policy if exists whats_on_listings_anon_deny on public.whats_on_listings;

drop index if exists public.whats_on_listings_kind_idx;

drop table if exists public.whats_on_listings;

commit;
