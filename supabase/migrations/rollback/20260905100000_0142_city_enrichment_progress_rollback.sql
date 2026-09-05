-- Rollback 0142: drop the city enrichment checkpoint.
--
-- Lossy by design, and safe: the checkpoint is operational state, so what goes
-- with the table is a cursor and a retry queue, never a price anybody
-- observed. lib/cityEnrichmentCheckpointStore.server.ts reads a missing table
-- as "no checkpoint yet" outside production, so the cron keeps running and
-- simply starts each city again rather than refusing every night.

begin;

drop policy if exists city_enrichment_progress_client_deny on public.city_enrichment_progress;

drop index if exists public.city_enrichment_progress_lease_idx;

drop table if exists public.city_enrichment_progress;

commit;
