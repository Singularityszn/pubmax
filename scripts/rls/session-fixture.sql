-- Minimal schema for effective RLS session tests.
-- Not a production migration. Applies only to a throwaway local Postgres.
-- Models the subset of tables and auth stubs needed to exercise wave-2 policies.

begin;

create extension if not exists "pgcrypto";

-- Supabase-style roles
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to service_role;

-- auth.uid() stub: reads request.jwt.claim.sub (same GUC Supabase uses)
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Core identity
create table if not exists public.profiles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid,
  handle       text not null unique,
  display_name text,
  created_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;

create table if not exists public.profile_handle_aliases (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  handle text not null,
  is_current boolean not null default true,
  claimed_at timestamptz not null default now(),
  retired_at timestamptz
);
alter table public.profile_handle_aliases enable row level security;

create table if not exists public.follows (
  id          uuid primary key default gen_random_uuid(),
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (follower_id, followee_id),
  check (follower_id <> followee_id)
);
alter table public.follows enable row level security;

create table if not exists public.private_account_identities (
  user_id uuid primary key,
  date_of_birth date not null,
  full_name text,
  sex text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.private_account_identities enable row level security;

-- Plans
create table if not exists public.plans (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  start_time    timestamptz not null default now(),
  owner_user_id uuid,
  created_at    timestamptz not null default now()
);
alter table public.plans enable row level security;

create table if not exists public.plan_stops (
  id         bigint generated always as identity primary key,
  plan_id    uuid not null references public.plans (id) on delete cascade,
  venue_id   text not null,
  venue_name text not null,
  position   smallint not null default 0
);
alter table public.plan_stops enable row level security;

create table if not exists public.plan_crew_members (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.plans (id) on delete cascade,
  name       text not null,
  status     text not null default 'in',
  token_hash text not null unique,
  user_id    uuid,
  joined_at  timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.plan_crew_members enable row level security;

-- Messages
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  handle_a        text not null,
  handle_b        text not null,
  user_id_a       uuid,
  user_id_b       uuid,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
alter table public.conversations enable row level security;

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_handle   text not null,
  sender_user_id  uuid,
  body            text not null,
  created_at      timestamptz not null default now()
);
alter table public.messages enable row level security;

-- Saved pubs
create table if not exists public.saved_pubs (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  venue_id   text not null,
  list_type  text not null default 'saved',
  note       text,
  created_at timestamptz not null default now()
);
alter table public.saved_pubs enable row level security;

-- Community prices
create table if not exists public.community_prices (
  id                 uuid primary key default gen_random_uuid(),
  venue_id           text not null,
  drink_category     text not null default 'beer',
  price_pennies      integer not null,
  actor              text,
  submitted_at       timestamptz not null default now(),
  contributor_handle text,
  corroborated_at    timestamptz,
  contradicted_at    timestamptz,
  hidden_at          timestamptz,
  moderated_at       timestamptz,
  moderator_note     text,
  report_count       integer not null default 0
);
alter table public.community_prices enable row level security;

-- Pint Drops
create table if not exists public.visit_reports (
  id               uuid primary key default gen_random_uuid(),
  venue_id         text not null,
  handle           text not null,
  drink            text,
  price_gbp        numeric,
  passed_down_note text,
  status           text not null default 'visible',
  visibility       text not null default 'public',
  created_at       timestamptz not null default now()
);
alter table public.visit_reports enable row level security;

-- Structured visit reports
create table if not exists public.structured_visit_reports (
  id         uuid primary key default gen_random_uuid(),
  venue_id   text not null,
  handle     text not null,
  visited_at date not null default current_date,
  note       text not null default '',
  status     text not null default 'visible',
  created_at timestamptz not null default now()
);
alter table public.structured_visit_reports enable row level security;

-- Rounds (for rollback / service-role-only tests)
create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  code text,
  created_at timestamptz not null default now()
);
alter table public.rounds enable row level security;

create table if not exists public.round_members (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds (id) on delete cascade,
  handle text not null
);
alter table public.round_members enable row level security;

create table if not exists public.round_stops (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds (id) on delete cascade,
  venue_id text not null,
  venue_name text not null,
  added_by_handle text not null
);
alter table public.round_stops enable row level security;

create table if not exists public.round_spends (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds (id) on delete cascade,
  client_ref text not null,
  payer_handle text not null,
  recorded_by_handle text not null,
  venue_id text not null,
  venue_name text not null,
  total_pence integer not null default 500,
  items jsonb not null default '[]'::jsonb
);
alter table public.round_spends enable row level security;

-- Night memories / stories / moments (minimal columns for RLS delete tests)
create table if not exists public.night_memories (
  id uuid primary key,
  owner_id uuid not null,
  title text not null default 'memory',
  visibility text not null default 'private',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.night_memories enable row level security;

create table if not exists public.night_moments (
  id uuid primary key,
  memory_id uuid not null references public.night_memories(id) on delete cascade,
  owner_id uuid not null,
  kind text not null default 'event',
  caption text not null default 'moment',
  visibility text not null default 'private',
  created_at timestamptz not null default now()
);
alter table public.night_moments enable row level security;

create table if not exists public.night_stories (
  id uuid primary key,
  memory_id uuid not null references public.night_memories(id) on delete cascade,
  host_editor_id uuid not null,
  title text not null default 'story',
  summary text not null default '',
  status text not null default 'draft',
  visibility text not null default 'private',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.night_stories enable row level security;

create table if not exists public.night_story_moments (
  story_id uuid not null references public.night_stories(id) on delete cascade,
  moment_id uuid not null references public.night_moments(id) on delete cascade,
  position integer not null default 0,
  primary key (story_id, moment_id)
);
alter table public.night_story_moments enable row level security;

-- Prior public-read policies that wave 2 closes (so 0068 has something to drop)
create policy rounds_public_read on public.rounds for select using (true);
create policy round_members_public_read on public.round_members for select using (true);
create policy round_stops_public_read on public.round_stops for select using (true);
create policy round_spends_public_read on public.round_spends for select using (true);

commit;
