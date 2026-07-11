-- P0 Sort My Night: shareable Plans and their live crew.
--
-- The UUID plan id is an unguessable link capability. Public, account-free reads
-- and name-only joins go through /api/plans/**, which uses the service role and
-- returns narrow DTOs. Direct anon/authenticated Data API access is deliberately
-- denied: plan_crew_members contains a token hash that must never be scrapeable.
-- Realtime rows are signals only; clients refetch the API and poll if RLS blocks
-- delivery. Nullable auth references reserve account-after-value without making
-- an account a prerequisite for creating or joining tonight.

create extension if not exists "pgcrypto";

create table if not exists public.plans (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(title) between 1 and 80),
  start_time    timestamptz not null,
  owner_user_id uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists plans_owner_user_idx
  on public.plans (owner_user_id) where owner_user_id is not null;

create table if not exists public.plan_stops (
  id         bigint generated always as identity primary key,
  plan_id    uuid not null references public.plans (id) on delete cascade,
  venue_id   text not null check (char_length(venue_id) between 1 and 80),
  venue_name text not null check (char_length(venue_name) between 1 and 120),
  position   smallint not null check (position between 0 and 7),
  unique (plan_id, position),
  unique (plan_id, venue_id)
);

create index if not exists plan_stops_plan_position_idx
  on public.plan_stops (plan_id, position);

create table if not exists public.plan_crew_members (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.plans (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  status     text not null default 'in'
    check (status in ('in', 'on_the_way', 'here', 'running_late', 'start_without_me')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id    uuid references auth.users (id) on delete set null,
  joined_at  timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plan_crew_members_plan_joined_idx
  on public.plan_crew_members (plan_id, joined_at);
create index if not exists plan_crew_members_user_idx
  on public.plan_crew_members (user_id) where user_id is not null;

alter table public.plans enable row level security;
alter table public.plan_stops enable row level security;
alter table public.plan_crew_members enable row level security;

-- Least privilege: browser roles cannot read token hashes or mutate Plans
-- directly. The API's service role is the sole data access path in v1.
revoke all on public.plans, public.plan_stops, public.plan_crew_members from anon, authenticated;
revoke all on sequence public.plan_stops_id_seq from anon, authenticated;
grant all on public.plans, public.plan_stops, public.plan_crew_members to service_role;
grant usage, select on sequence public.plan_stops_id_seq to service_role;

-- Signal-only realtime. RLS may withhold events from an anon browser; the
-- client intentionally switches to its 30-second polling fallback in that case.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'plan_crew_members'
  ) then
    alter publication supabase_realtime add table public.plan_crew_members;
  end if;
end $$;
