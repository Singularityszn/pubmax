-- Supabase platform bootstrap for effective RLS session tests.
-- Not a production migration. Application tables and policies come from the
-- repository's real pre-wave migration history.

begin;

-- Mirrors Supabase, which installs pgcrypto in the extensions schema
-- rather than public. Migrations that call digest() must qualify it as
-- extensions.digest(...) or include extensions in their search_path.
create schema if not exists extensions;
create extension if not exists "pgcrypto" with schema extensions;

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
grant usage on schema extensions to anon, authenticated, service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables
  to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

-- The stand-in for GoTrue's own table. Only the columns a migration reads are
-- here: `encrypted_password` because 0099 asks whether an account has one, and
-- nothing about it is ever selected out; `banned_until` because 0157 withdraws
-- a banned account's profile from public view.
create table if not exists auth.users (
  id uuid primary key,
  encrypted_password text,
  banned_until timestamptz,
  created_at timestamptz not null default now()
);

alter table auth.users
  add column if not exists encrypted_password text;
alter table auth.users
  add column if not exists banned_until timestamptz;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
      current_setting('request.jwt.claim.sub', true)
    ),
    ''
  )::uuid;
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase Storage owns this schema in production. Private bucket objects are
-- readable through server-minted signed URLs, not direct client table access.
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  name text not null,
  owner_id uuid,
  metadata jsonb
);
alter table storage.objects enable row level security;
grant select on table storage.objects to anon, authenticated;
grant all on table storage.objects to service_role;

-- Realtime migrations add selected tables only when this publication exists.
create publication supabase_realtime;

-- Supabase Realtime owns this schema in production. Only the two things a
-- migration or a policy reads are here: `realtime.messages`, the table Realtime
-- runs its channel authorization check against, and `realtime.topic()`, which
-- names the channel being joined. Realtime sets the topic per check; a test
-- stands in for that with `set local realtime.topic = '<topic>'`.
create schema if not exists realtime;
grant usage on schema realtime to anon, authenticated, service_role;

create table if not exists realtime.messages (
  id         uuid primary key default gen_random_uuid(),
  topic      text not null,
  extension  text not null,
  payload    jsonb,
  event      text,
  private    boolean not null default false,
  inserted_at timestamptz not null default now()
);
alter table realtime.messages enable row level security;
grant select, insert on table realtime.messages to anon, authenticated;
grant all on table realtime.messages to service_role;

create or replace function realtime.topic()
returns text
language sql
stable
as $$
  select nullif(current_setting('realtime.topic', true), '');
$$;
grant execute on function realtime.topic() to anon, authenticated, service_role;

commit;
