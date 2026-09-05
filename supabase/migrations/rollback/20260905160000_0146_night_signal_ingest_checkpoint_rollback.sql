-- Rollback for 0146. The checkpoint is operational state alone, so dropping it
-- costs the sweep its lease and its attempt counts and costs no candidate: the
-- pending rows stay in public.night_signal_claims and a person can still review
-- them at /api/admin/night-signals.

begin;

drop policy if exists night_signal_ingest_checkpoint_client_deny
  on public.night_signal_ingest_checkpoint;

drop index if exists public.night_signal_ingest_checkpoint_lease_idx;

drop table if exists public.night_signal_ingest_checkpoint;

commit;
