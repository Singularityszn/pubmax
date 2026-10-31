-- "With" on a Pint Drop as consented handle tags (WEEK1_HYGIENE_BUILD round 2,
-- "Tag who you went with"). A tag is a PROPOSAL from the drop's author to a
-- claimed handle. It lands in that person's tag inbox, and only an approved
-- tag ever prints the handle; until then a reader sees "with 1 person".
-- The states copy the photo tags (0074): a decline, a withdrawal and a cancel
-- are kept as rows so the same pair cannot be proposed again.
-- Service-mediated: the route holds the service role (lib/pintDropWithTagsStore.ts),
-- and the browser roles hold nothing.
begin;
create table public.pint_drop_with_tags (
  id uuid primary key default gen_random_uuid(),
  drop_id uuid not null references public.pint_drops(id) on delete cascade,
  tagger_profile_id uuid not null references public.profiles(id) on delete cascade,
  tagger_handle text not null check (length(tagger_handle) between 1 and 31),
  target_profile_id uuid not null references public.profiles(id) on delete cascade,
  target_handle text not null check (length(target_handle) between 1 and 31),
  state text not null default 'proposed'
    check (state in ('proposed', 'approved', 'declined', 'withdrawn', 'cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (drop_id, target_profile_id),
  check (tagger_profile_id <> target_profile_id)
);
create index pint_drop_with_tags_target_state_idx
  on public.pint_drop_with_tags(target_profile_id, state, created_at desc, id desc);
create index pint_drop_with_tags_drop_idx
  on public.pint_drop_with_tags(drop_id);
create index pint_drop_with_tags_tagger_idx
  on public.pint_drop_with_tags(tagger_profile_id);
alter table public.pint_drop_with_tags enable row level security;
revoke all on public.pint_drop_with_tags from public, anon, authenticated;
grant select, insert, update, delete on public.pint_drop_with_tags to service_role;
commit;
