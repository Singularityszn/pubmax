-- Imported lists are private Planned Night drafts until the owner builds a crawl.
-- Pasted text, raw lines and creator descriptions are deliberately absent.
begin;
create table public.pub_list_night_drafts (
  id uuid not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  venue_ids text[] not null check (cardinality(venue_ids) between 1 and 40),
  source_url text check (source_url is null or (length(source_url) <= 2048 and source_url like 'https://%')),
  source_platform text check (source_platform in ('tiktok','instagram','other')),
  source_handle text check (source_handle is null or length(source_handle) <= 31),
  created_at timestamptz not null default now(),
  primary key (owner_user_id, id),
  check ((source_url is null and source_platform is null and source_handle is null)
    or (source_url is not null and source_platform is not null))
);
create index pub_list_night_drafts_owner_created_idx
  on public.pub_list_night_drafts(owner_user_id, created_at desc);
alter table public.pub_list_night_drafts enable row level security;
revoke all on public.pub_list_night_drafts from public, anon, authenticated;
grant select on public.pub_list_night_drafts to authenticated;
grant select, insert, update, delete on public.pub_list_night_drafts to service_role;
create policy pub_list_night_drafts_owner_read on public.pub_list_night_drafts
  for select to authenticated using (owner_user_id = (select auth.uid()));
commit;
