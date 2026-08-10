-- Wanted privacy and drink interest (0104).
-- Captain applies this migration before the app writes the new columns.

begin;

alter table public.wanteds
  add column if not exists drink_interest text,
  add column if not exists visibility text not null default 'private';

alter table public.wanteds
  drop constraint if exists wanteds_drink_interest_check,
  drop constraint if exists wanteds_visibility_check;

alter table public.wanteds
  add constraint wanteds_drink_interest_check
  check (
    drink_interest is null
    or drink_interest in (
      'beer', 'wine', 'whisky', 'gin', 'vodka', 'rum', 'cocktail',
      'shot', 'alcohol-free', 'soft-drink', 'coffee', 'other'
    )
  ),
  add constraint wanteds_visibility_check
  check (
    visibility in ('private', 'mutuals')
    or visibility ~ '^crew:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

create index if not exists wanteds_visibility_idx
  on public.wanteds (visibility, created_at desc);

-- Keep direct PostgREST access owner-only. Shared reads go through server
-- routes, which verify the mutual or Crew relationship before service-role read.
drop policy if exists wanteds_owner_select on public.wanteds;
create policy wanteds_owner_select
  on public.wanteds
  for select
  to authenticated
  using (
    owner_actor like 'profile:%'
    and pubmax_private.rls_owns_profile((substring(owner_actor from 9))::uuid)
  );

commit;
