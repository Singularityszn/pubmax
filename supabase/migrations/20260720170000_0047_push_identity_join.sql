-- Wave 1.4: attach an existing anonymous push registration to either a
-- VERIFIED claimed account or a VERIFIED Plan member. Registration itself
-- remains anonymous and public London broadcasts remain identity-free.
--
-- This migration only adds nullable/link data. It does not send a targeted
-- notification and it does not expose token, account, or crew data through
-- RLS. Every RPC is service-role-only; API routes establish JWT/capability
-- authority before calling it.

alter table public.push_tokens
  add column if not exists account_user_id uuid references auth.users(id) on delete set null,
  add column if not exists account_linked_at timestamptz;

create index if not exists push_tokens_account_user_idx
  on public.push_tokens(account_user_id)
  where account_user_id is not null;

-- Supports a composite foreign key so even a direct service-role insert cannot
-- pair a member with a different Plan. The member id remains globally unique;
-- this adds the exact relational invariant the join table needs.
create unique index if not exists plan_crew_members_plan_member_unique
  on public.plan_crew_members(plan_id, id);

create table if not exists public.push_token_plan_memberships (
  token text not null references public.push_tokens(token) on delete cascade,
  plan_id uuid not null,
  member_id uuid not null,
  linked_at timestamptz not null default now(),
  primary key (token, plan_id),
  constraint push_token_plan_memberships_member_plan_fk
    foreign key (plan_id, member_id)
    references public.plan_crew_members(plan_id, id)
    on delete cascade
);

create index if not exists push_token_plan_memberships_plan_idx
  on public.push_token_plan_memberships(plan_id, linked_at);
create index if not exists push_token_plan_memberships_member_idx
  on public.push_token_plan_memberships(member_id);

alter table public.push_token_plan_memberships enable row level security;

revoke all on public.push_token_plan_memberships from public, anon, authenticated;
grant select, insert, delete on public.push_token_plan_memberships to service_role;

comment on column public.push_tokens.account_user_id is
  'Optional verified account join. Set only by the service-role RPC after JWT verification and claimed-profile lookup.';
comment on table public.push_token_plan_memberships is
  'Private push targeting joins. Member ids are derived server-side from hashed Plan capabilities; never accepted from a client.';

-- One token can have at most one current account owner. Possession of a token
-- is not enough to steal it from an existing owner: reassignment is rejected
-- until that same verified owner unlinks it. Row locking makes concurrent
-- first-link attempts deterministic.
create or replace function public.link_push_token_account_atomic(
  p_token text,
  p_user_id uuid,
  p_linked_at timestamptz
) returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_token public.push_tokens%rowtype;
begin
  if p_token is null or p_user_id is null or p_linked_at is null then return 'missing'; end if;
  select * into v_token from public.push_tokens where token = p_token for update;
  if not found then return 'missing'; end if;
  if v_token.account_user_id = p_user_id then return 'replayed'; end if;
  if v_token.account_user_id is not null then return 'conflict'; end if;
  update public.push_tokens
  set account_user_id = p_user_id, account_linked_at = p_linked_at
  where token = p_token;
  return 'linked';
end;
$$;

-- Deliberately returns the same status for missing, already-unlinked, and
-- wrong-owner rows. A caller cannot use logout/privacy cleanup to enumerate
-- another account's registrations.
create or replace function public.unlink_push_token_account_atomic(
  p_token text,
  p_user_id uuid
) returns text
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_token is null or p_user_id is null then return 'unlinked'; end if;
  update public.push_tokens
  set account_user_id = null, account_linked_at = null
  where token = p_token and account_user_id = p_user_id;
  return 'unlinked';
end;
$$;

-- Account-erasure/privacy seam. The account link is removed but the anonymous
-- registration survives, so identity-free public briefs keep their original
-- opt-in semantics.
create or replace function public.unlink_all_push_tokens_for_account(
  p_user_id uuid
) returns text
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_user_id is null then return 'unlinked'; end if;
  update public.push_tokens
  set account_user_id = null, account_linked_at = null
  where account_user_id = p_user_id;
  return 'unlinked';
end;
$$;

-- The API resolves p_member_id from the private member capability. The RPC
-- verifies that membership again and atomically refuses cross-member
-- reassignment within a Plan. A device may legitimately join multiple Plans.
create or replace function public.link_push_token_plan_member_atomic(
  p_token text,
  p_plan_id uuid,
  p_member_id uuid,
  p_linked_at timestamptz
) returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_link public.push_token_plan_memberships%rowtype;
begin
  if p_token is null or p_plan_id is null or p_member_id is null or p_linked_at is null then return 'missing'; end if;
  perform 1 from public.push_tokens where token = p_token for update;
  if not found then return 'missing'; end if;
  perform 1 from public.plan_crew_members where id = p_member_id and plan_id = p_plan_id;
  if not found then return 'missing'; end if;

  select * into v_link from public.push_token_plan_memberships
  where token = p_token and plan_id = p_plan_id
  for update;
  if found then
    if v_link.member_id = p_member_id then return 'replayed'; end if;
    return 'conflict';
  end if;

  insert into public.push_token_plan_memberships(token, plan_id, member_id, linked_at)
  values (p_token, p_plan_id, p_member_id, p_linked_at);
  return 'linked';
end;
$$;

-- As with account unlink, missing/wrong-member rows collapse to one idempotent
-- result. Deleting the push token, Plan, or crew member also revokes this join
-- through the foreign-key cascades above.
create or replace function public.unlink_push_token_plan_member_atomic(
  p_token text,
  p_plan_id uuid,
  p_member_id uuid
) returns text
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_token is null or p_plan_id is null or p_member_id is null then return 'unlinked'; end if;
  delete from public.push_token_plan_memberships
  where token = p_token and plan_id = p_plan_id and member_id = p_member_id;
  return 'unlinked';
end;
$$;

revoke all on function public.link_push_token_account_atomic(text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.unlink_push_token_account_atomic(text, uuid) from public, anon, authenticated;
revoke all on function public.unlink_all_push_tokens_for_account(uuid) from public, anon, authenticated;
revoke all on function public.link_push_token_plan_member_atomic(text, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.unlink_push_token_plan_member_atomic(text, uuid, uuid) from public, anon, authenticated;

grant execute on function public.link_push_token_account_atomic(text, uuid, timestamptz) to service_role;
grant execute on function public.unlink_push_token_account_atomic(text, uuid) to service_role;
grant execute on function public.unlink_all_push_tokens_for_account(uuid) to service_role;
grant execute on function public.link_push_token_plan_member_atomic(text, uuid, uuid, timestamptz) to service_role;
grant execute on function public.unlink_push_token_plan_member_atomic(text, uuid, uuid) to service_role;
