-- Rollback of 0120. This DROPS THE LIFECYCLE COLUMNS AND EVERY VALUE IN THEM,
-- and it RE-OPENS THE TABLE DOOR that 0120 closed.
--
-- Worth saying plainly, because the two halves are not the same kind of loss.
-- The columns are recoverable: 0120's own backfill derives refresh_status,
-- consent_version and upstream_revocation_state from `mode` alone, so a
-- re-apply reconstructs exactly what a rollback discards, minus any lifecycle
-- state written since. `fetched_at` is the one exception, coalescing to
-- `updated_at` on the way back in, so a genuine fetch time is lost.
--
-- The door is not recoverable by re-applying anything else. 0120 revoked the
-- browser roles' table grants that 0067 gave and dropped 0067's owner and
-- anon-deny policies, on the reasoning that these rows hold refresh
-- credentials and belong to the service role alone. Restoring 0067's state is
-- what this file does, and after it runs a signed-in browser can once again
-- SELECT its own external_social_accounts rows through PostgREST. Roll this
-- back only alongside the code that expects that door, never as tidying.
--
-- The lifecycle CHECK constraints go with the columns, so any row written
-- while 0120 was live keeps its mode and its credentials and simply stops
-- carrying a lifecycle answer.

begin;

alter table public.external_social_accounts
  drop constraint if exists external_social_accounts_lifecycle_mode_check,
  drop constraint if exists external_social_accounts_revocation_state_check,
  drop constraint if exists external_social_accounts_refresh_status_check;

alter table public.external_social_accounts
  drop column if exists upstream_revocation_state,
  drop column if exists fetched_at,
  drop column if exists consent_version,
  drop column if exists refresh_status;

-- Restore 0067's grants and policies verbatim.
revoke all on table public.external_social_accounts from anon, authenticated;
grant select, insert, update, delete on table public.external_social_accounts to authenticated;
grant select, insert, update, delete on table public.external_social_accounts to service_role;

drop policy if exists external_social_accounts_owner_all on public.external_social_accounts;
create policy external_social_accounts_owner_all
  on public.external_social_accounts for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists external_social_accounts_anon_deny on public.external_social_accounts;
create policy external_social_accounts_anon_deny
  on public.external_social_accounts for all to anon
  using (false) with check (false);

commit;
