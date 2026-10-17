-- Rollback 0181: drop the venue submission tables. THIS DELETES EVERY PUB
-- ANYBODY HAS SUBMITTED, WITH ITS PRICES AND ITS MENU FILE ROWS. The menu bytes
-- stay in the bucket under `venue-submissions/`; remove that folder through the
-- Storage API afterwards (SQL cannot delete storage objects). Export first if
-- any rows matter.

begin;

drop policy if exists venue_submission_files_client_deny on public.venue_submission_files;
drop policy if exists venue_submissions_client_deny on public.venue_submissions;

drop index if exists public.venue_submission_files_submission_idx;
drop index if exists public.venue_submissions_status_created_idx;
drop index if exists public.venue_submissions_owner_created_idx;

drop table if exists public.venue_submission_files;
drop table if exists public.venue_submissions;

commit;
