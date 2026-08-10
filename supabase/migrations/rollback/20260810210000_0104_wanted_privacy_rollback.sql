-- Rollback 0104 Wanted privacy and drink interest.

begin;

drop index if exists public.wanteds_visibility_idx;
alter table public.wanteds
  drop constraint if exists wanteds_drink_interest_check,
  drop constraint if exists wanteds_visibility_check;
alter table public.wanteds
  drop column if exists drink_interest,
  drop column if exists visibility;

commit;
