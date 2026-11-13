-- Leagues (0239): private leagues of drinkers ranked by points.
-- Captain applies. Agents ship SQL and a rollback beside it.
-- Reverse: rollback/20261113090000_0239_leagues_rollback.sql
--
-- WHAT A ROW IS. A league is a name, the account that made it and one invite
-- code. A member row says one account is in one league. Nothing here holds a
-- score: points are read from each member's own records at read time
-- (lib/points.server.ts), so a league can never show a figure nobody earned.
--
-- THE CODE IS THE INVITE. Eight characters from an alphabet with no 0, O, 1
-- or I, so it reads aloud. Anyone holding it can join, so the owner can swap
-- it, and the old code stops working at once. It is stored as written because
-- every member is shown it to pass on.
--
-- BOUNDED BY DESIGN. One account is in at most 10 leagues and a league holds
-- at most 20 members, so one board read stays a bounded read. Both limits are
-- checked inside the one write that could pass them, under a lock, so two
-- joins at once cannot pass them either.
--
-- LEAVES WITH THE ACCOUNT. Both tables key to the auth user with ON DELETE
-- CASCADE, the 0219 shape: deleting an account deletes its memberships and
-- every league it owns, with their members, and the tombstone trigger needs no
-- edit.
--
-- SERVICE ROLE ONLY. RLS is on, no browser role has a grant and no policy
-- names anon or authenticated. Every read and write goes through /api/leagues
-- on the service role, which checks membership, blocks, mutes and private
-- profiles before it names anybody.

begin;

create table if not exists public.leagues (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  owner_user_id  uuid not null references auth.users (id) on delete cascade,
  invite_code    text not null,
  created_at     timestamptz not null default now(),
  constraint leagues_name_check
    check (char_length(name) between 1 and 40 and name = btrim(name)),
  constraint leagues_invite_code_check
    check (invite_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  constraint leagues_invite_code_key unique (invite_code)
);

create index if not exists leagues_owner_idx
  on public.leagues (owner_user_id);

create table if not exists public.league_members (
  league_id   uuid not null references public.leagues (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  joined_at   timestamptz not null default now(),
  primary key (league_id, user_id)
);

-- A member's own leagues, newest first, and the account-deletion cascade.
create index if not exists league_members_user_idx
  on public.league_members (user_id, joined_at desc);

-- Covers the profile foreign key.
create index if not exists league_members_profile_idx
  on public.league_members (profile_id);

alter table public.leagues enable row level security;
alter table public.league_members enable row level security;

revoke all on table public.leagues from public, anon, authenticated;
revoke all on table public.league_members from public, anon, authenticated;
grant select, insert, update, delete on table public.leagues to service_role;
grant select, insert, update, delete on table public.league_members to service_role;

-- Make a league and put its owner in it, in one transaction.
-- Answers {code: created, league_id} | {code: limit} | {code: code_taken}.
create or replace function public.create_league(
  p_user_id uuid,
  p_profile_id uuid,
  p_name text,
  p_invite_code text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_league_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('league-member:' || p_user_id::text, 0));
  if (select count(*) from public.league_members where user_id = p_user_id) >= 10 then
    return jsonb_build_object('code', 'limit');
  end if;
  begin
    insert into public.leagues (name, owner_user_id, invite_code)
    values (p_name, p_user_id, p_invite_code)
    returning id into v_league_id;
  exception when unique_violation then
    return jsonb_build_object('code', 'code_taken');
  end;
  insert into public.league_members (league_id, user_id, profile_id)
  values (v_league_id, p_user_id, p_profile_id);
  return jsonb_build_object('code', 'created', 'league_id', v_league_id);
end;
$$;

-- Join the league a code names.
-- Answers {code: joined | already, league_id} | {code: not_found | limit | full}.
create or replace function public.join_league(
  p_user_id uuid,
  p_profile_id uuid,
  p_invite_code text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_league_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('league-member:' || p_user_id::text, 0));
  select id into v_league_id
  from public.leagues
  where invite_code = p_invite_code
  for update;
  if not found then
    return jsonb_build_object('code', 'not_found');
  end if;
  if exists (
    select 1 from public.league_members
    where league_id = v_league_id and user_id = p_user_id
  ) then
    return jsonb_build_object('code', 'already', 'league_id', v_league_id);
  end if;
  if (select count(*) from public.league_members where user_id = p_user_id) >= 10 then
    return jsonb_build_object('code', 'limit');
  end if;
  if (select count(*) from public.league_members where league_id = v_league_id) >= 20 then
    return jsonb_build_object('code', 'full');
  end if;
  insert into public.league_members (league_id, user_id, profile_id)
  values (v_league_id, p_user_id, p_profile_id);
  return jsonb_build_object('code', 'joined', 'league_id', v_league_id);
end;
$$;

revoke all on function public.create_league(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.join_league(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_league(uuid, uuid, text, text) to service_role;
grant execute on function public.join_league(uuid, uuid, text) to service_role;

commit;
