-- Wave 1.4: private push identity joins with durable, order-independent
-- revocation. The opaque installation UUID is an epoch, not user identity.
-- Every client identity intent carries a monotonic version within that epoch.
-- Durable watermarks make the later client intent win even when PostgreSQL
-- receives DELETE before an older delayed POST. Targeted sending remains off.

alter table public.push_tokens
  add column if not exists installation_id uuid,
  add column if not exists account_user_id uuid references auth.users(id) on delete set null,
  add column if not exists account_session_id uuid,
  add column if not exists account_installation_id uuid,
  add column if not exists account_mutation_version bigint,
  add column if not exists account_linked_at timestamptz;

alter table public.push_tokens
  add constraint push_tokens_account_mutation_version_safe
  check (account_mutation_version is null or account_mutation_version between 1 and 9007199254740991);

create index if not exists push_tokens_installation_idx on public.push_tokens(installation_id);
create index if not exists push_tokens_account_user_idx on public.push_tokens(account_user_id)
  where account_user_id is not null;

create table if not exists public.push_token_account_mutation_versions (
  token text not null references public.push_tokens(token) on delete cascade,
  installation_id uuid not null,
  mutation_version bigint not null check (mutation_version between 1 and 9007199254740991),
  expires_at timestamptz not null default (now() + interval '30 days'),
  primary key (token, installation_id)
);

-- Multiple old sessions are retained independently. A later logout never
-- overwrites an earlier session revocation.
create table if not exists public.push_token_account_revocations (
  token text not null references public.push_tokens(token) on delete cascade,
  session_id uuid not null,
  revoked_version bigint not null check (revoked_version between 1 and 9007199254740991),
  expires_at timestamptz not null default (now() + interval '30 days'),
  primary key (token, session_id)
);

-- Native permission can be denied while an old APNs token remains durable.
-- This installation/session tombstone revokes without knowing the raw token.
create table if not exists public.push_installation_account_revocations (
  installation_id uuid not null,
  session_id uuid not null,
  revoked_version bigint not null check (revoked_version between 1 and 9007199254740991),
  expires_at timestamptz not null default (now() + interval '30 days'),
  primary key (installation_id, session_id)
);

create unique index if not exists plan_crew_members_plan_member_unique
  on public.plan_crew_members(plan_id, id);

create table if not exists public.push_token_plan_memberships (
  token text not null references public.push_tokens(token) on delete cascade,
  plan_id uuid not null,
  member_id uuid not null,
  installation_id uuid not null,
  mutation_version bigint not null check (mutation_version between 1 and 9007199254740991),
  linked_at timestamptz not null default now(),
  primary key (token, plan_id),
  constraint push_token_plan_memberships_member_plan_fk
    foreign key (plan_id, member_id)
    references public.plan_crew_members(plan_id, id)
    on delete cascade
);

create table if not exists public.push_token_plan_mutation_versions (
  token text not null references public.push_tokens(token) on delete cascade,
  installation_id uuid not null,
  plan_id uuid not null,
  mutation_version bigint not null check (mutation_version between 1 and 9007199254740991),
  expires_at timestamptz not null default (now() + interval '30 days'),
  primary key (token, installation_id, plan_id)
);

create index if not exists push_token_plan_memberships_plan_idx
  on public.push_token_plan_memberships(plan_id, linked_at);
create index if not exists push_account_revocations_expiry_idx
  on public.push_token_account_revocations(expires_at);
create index if not exists push_installation_revocations_expiry_idx
  on public.push_installation_account_revocations(expires_at);
create index if not exists push_account_versions_expiry_idx
  on public.push_token_account_mutation_versions(expires_at);
create index if not exists push_plan_versions_expiry_idx
  on public.push_token_plan_mutation_versions(expires_at);

alter table public.push_token_plan_memberships enable row level security;
alter table public.push_token_account_mutation_versions enable row level security;
alter table public.push_token_account_revocations enable row level security;
alter table public.push_installation_account_revocations enable row level security;
alter table public.push_token_plan_mutation_versions enable row level security;

revoke all on public.push_token_plan_memberships from public, anon, authenticated;
revoke all on public.push_token_account_mutation_versions from public, anon, authenticated;
revoke all on public.push_token_account_revocations from public, anon, authenticated;
revoke all on public.push_installation_account_revocations from public, anon, authenticated;
revoke all on public.push_token_plan_mutation_versions from public, anon, authenticated;
grant select, insert, update, delete on public.push_token_plan_memberships to service_role;
grant select, insert, update, delete on public.push_token_account_mutation_versions to service_role;
grant select, insert, update, delete on public.push_token_account_revocations to service_role;
grant select, insert, update, delete on public.push_installation_account_revocations to service_role;
grant select, insert, update, delete on public.push_token_plan_mutation_versions to service_role;

comment on table public.push_token_account_revocations is
  'Per-token/session logout tombstones retained for 30 days and pruned on identity mutations.';
comment on table public.push_installation_account_revocations is
  'Permission-independent logout authority for an opaque installation epoch; contains no provider token.';
comment on table public.push_token_plan_mutation_versions is
  'Plan link/unlink watermark. A lower version is stale regardless of database arrival order.';

create or replace function public.register_push_token_installation_atomic(
  p_token text, p_platform text, p_installation_id uuid, p_seen_at timestamptz
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare v_token public.push_tokens%rowtype;
begin
  if p_token is null or p_installation_id is null or p_seen_at is null
     or p_platform not in ('ios', 'android', 'web') then return null; end if;
  -- Registration is the high-frequency bounded cleanup seam, so expired
  -- tombstones cannot accumulate when logged-out installations never return.
  delete from public.push_token_account_revocations where expires_at <= now();
  delete from public.push_installation_account_revocations where expires_at <= now();
  delete from public.push_token_account_mutation_versions where expires_at <= now();
  delete from public.push_token_plan_mutation_versions where expires_at <= now();
  perform pg_advisory_xact_lock(hashtextextended('push-register:' || p_token, 0));
  insert into public.push_tokens(token, platform, installation_id, created_at, last_seen_at)
  values (p_token, p_platform, p_installation_id, p_seen_at, p_seen_at)
  on conflict (token) do nothing;
  select * into v_token from public.push_tokens where token = p_token for update;
  if not found or (v_token.installation_id is not null and v_token.installation_id <> p_installation_id)
    then return null; end if;
  update public.push_tokens set platform = p_platform,
    installation_id = p_installation_id, last_seen_at = p_seen_at where token = p_token;
  return jsonb_build_object('token', p_token, 'platform', p_platform,
    'created_at', v_token.created_at, 'last_seen_at', p_seen_at);
end;
$$;

create or replace function public.link_push_token_account_atomic(
  p_token text, p_user_id uuid, p_session_id uuid, p_installation_id uuid,
  p_mutation_version bigint, p_linked_at timestamptz
) returns text
language plpgsql security invoker set search_path = public
as $$
declare v_token public.push_tokens%rowtype; v_version bigint;
begin
  if p_token is null or p_user_id is null or p_session_id is null or p_installation_id is null
     or p_mutation_version is null or p_mutation_version <= 0
     or p_mutation_version > 9007199254740991 or p_linked_at is null then return 'missing'; end if;
  -- Share the installation lock with permission-independent logout. This also
  -- closes register/link racing a DELETE that began before the token existed.
  perform pg_advisory_xact_lock(hashtextextended('push-installation:' || p_installation_id::text, 0));
  -- Account-wide erasure takes the same lock between the installation and
  -- token locks. Whichever transaction acquires it first determines whether
  -- this link is observed and cleared or rejected by its session tombstone.
  perform pg_advisory_xact_lock(hashtextextended('push-account-all:' || p_user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('push-account:' || p_token || ':' || p_installation_id::text, 0));
  delete from public.push_token_account_revocations where expires_at <= now();
  delete from public.push_installation_account_revocations where expires_at <= now();
  delete from public.push_token_account_mutation_versions where expires_at <= now();
  select * into v_token from public.push_tokens where token = p_token for update;
  if not found or v_token.installation_id is distinct from p_installation_id then return 'missing'; end if;
  if exists (select 1 from public.push_token_account_revocations
      where token = p_token and session_id = p_session_id and expires_at > now())
     or exists (select 1 from public.push_installation_account_revocations
      where installation_id = p_installation_id and session_id = p_session_id and expires_at > now())
    then return 'conflict'; end if;
  select mutation_version into v_version from public.push_token_account_mutation_versions
    where token = p_token and installation_id = p_installation_id for update;
  v_version := greatest(
    coalesce(v_version, 0),
    case when v_token.account_installation_id = p_installation_id
      then coalesce(v_token.account_mutation_version, 0) else 0 end
  );
  if p_mutation_version < v_version then return 'stale'; end if;
  if p_mutation_version = v_version then
    if v_token.account_user_id = p_user_id and v_token.account_session_id = p_session_id
      then return 'replayed'; end if;
    return 'stale';
  end if;
  if v_token.account_user_id is not null and v_token.account_user_id <> p_user_id then return 'conflict'; end if;
  insert into public.push_token_account_mutation_versions(token, installation_id, mutation_version, expires_at)
    values (p_token, p_installation_id, p_mutation_version, now() + interval '30 days')
    on conflict (token, installation_id) do update set mutation_version = excluded.mutation_version,
      expires_at = excluded.expires_at;
  update public.push_tokens set account_user_id = p_user_id, account_session_id = p_session_id,
    account_installation_id = p_installation_id, account_mutation_version = p_mutation_version,
    account_linked_at = p_linked_at where token = p_token;
  return 'linked';
end;
$$;

create or replace function public.unlink_push_token_account_atomic(
  p_token text, p_user_id uuid, p_session_id uuid, p_installation_id uuid,
  p_mutation_version bigint
) returns bigint
language plpgsql security invoker set search_path = public
as $$
declare v_token public.push_tokens%rowtype; v_version bigint; v_authoritative bigint;
begin
  if p_token is null or p_user_id is null or p_session_id is null or p_installation_id is null
     or p_mutation_version is null or p_mutation_version <= 0
     or p_mutation_version > 9007199254740991 then
    raise exception 'invalid push identity mutation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('push-account:' || p_token || ':' || p_installation_id::text, 0));
  select * into v_token from public.push_tokens where token = p_token for update;
  if not found or v_token.installation_id is distinct from p_installation_id then
    insert into public.push_installation_account_revocations(installation_id, session_id, revoked_version, expires_at)
      values (p_installation_id, p_session_id, p_mutation_version, now() + interval '30 days')
      on conflict (installation_id, session_id) do update
        set revoked_version = greatest(public.push_installation_account_revocations.revoked_version, excluded.revoked_version),
          expires_at = greatest(public.push_installation_account_revocations.expires_at, excluded.expires_at);
    return p_mutation_version;
  end if;
  if v_token.account_user_id is not null and v_token.account_user_id <> p_user_id then
    return p_mutation_version;
  end if;
  if v_token.account_user_id = p_user_id
     and v_token.account_session_id is distinct from p_session_id then
    insert into public.push_token_account_revocations(token, session_id, revoked_version, expires_at)
      values (p_token, p_session_id, p_mutation_version, now() + interval '30 days')
      on conflict (token, session_id) do update
        set revoked_version = greatest(public.push_token_account_revocations.revoked_version, excluded.revoked_version),
          expires_at = greatest(public.push_token_account_revocations.expires_at, excluded.expires_at);
    insert into public.push_installation_account_revocations(installation_id, session_id, revoked_version, expires_at)
      values (p_installation_id, p_session_id, p_mutation_version, now() + interval '30 days')
      on conflict (installation_id, session_id) do update
        set revoked_version = greatest(public.push_installation_account_revocations.revoked_version, excluded.revoked_version),
          expires_at = greatest(public.push_installation_account_revocations.expires_at, excluded.expires_at);
    return p_mutation_version;
  end if;
  select mutation_version into v_version from public.push_token_account_mutation_versions
    where token = p_token and installation_id = p_installation_id for update;
  v_version := greatest(
    coalesce(v_version, 0),
    case when v_token.account_installation_id = p_installation_id
      then coalesce(v_token.account_mutation_version, 0) else 0 end
  );
  if v_version >= 9007199254740991 then
    raise exception 'push mutation watermark exhausted';
  end if;
  v_authoritative := greatest(v_version + 1, p_mutation_version);
  insert into public.push_token_account_revocations(token, session_id, revoked_version, expires_at)
    values (p_token, p_session_id, v_authoritative, now() + interval '30 days')
    on conflict (token, session_id) do update set revoked_version = greatest(public.push_token_account_revocations.revoked_version, excluded.revoked_version),
      expires_at = greatest(public.push_token_account_revocations.expires_at, excluded.expires_at);
  insert into public.push_installation_account_revocations(installation_id, session_id, revoked_version, expires_at)
    values (p_installation_id, p_session_id, v_authoritative, now() + interval '30 days')
    on conflict (installation_id, session_id) do update set revoked_version = greatest(public.push_installation_account_revocations.revoked_version, excluded.revoked_version),
      expires_at = greatest(public.push_installation_account_revocations.expires_at, excluded.expires_at);
  insert into public.push_token_account_mutation_versions(token, installation_id, mutation_version, expires_at)
    values (p_token, p_installation_id, v_authoritative, now() + interval '30 days')
    on conflict (token, installation_id) do update set mutation_version = excluded.mutation_version,
      expires_at = excluded.expires_at;
  update public.push_tokens set account_user_id = null, account_session_id = null,
    account_installation_id = null, account_mutation_version = v_authoritative, account_linked_at = null
  where token = p_token and account_user_id = p_user_id
    and account_installation_id = p_installation_id;
  return v_authoritative;
end;
$$;

create or replace function public.unlink_push_installation_account_atomic(
  p_installation_id uuid, p_user_id uuid, p_session_id uuid, p_mutation_version bigint
) returns bigint
language plpgsql security invoker set search_path = public
as $$
declare v_version bigint; v_authoritative bigint; v_has_fence_rows boolean;
begin
  if p_installation_id is null or p_user_id is null or p_session_id is null
     or p_mutation_version is null or p_mutation_version <= 0
     or p_mutation_version > 9007199254740991 then
    raise exception 'invalid push identity mutation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('push-installation:' || p_installation_id::text, 0));
  perform 1 from public.push_tokens where installation_id = p_installation_id
    and (account_user_id is null
      or (account_user_id = p_user_id and account_session_id = p_session_id))
    order by token for update;
  -- Installation possession is not account authority. Apply the caller's
  -- logout row by row: anonymous registrations and this exact account/session
  -- may be fenced, while foreign owners and newer sessions remain untouched.
  select exists (
    select 1 from public.push_tokens
    where installation_id = p_installation_id
      and (account_user_id is null
        or (account_user_id = p_user_id and account_session_id = p_session_id))
  ) into v_has_fence_rows;
  select greatest(
    coalesce((select max(mutation_version)
      from public.push_token_account_mutation_versions as versions
      join public.push_tokens as tokens on tokens.token = versions.token
      where versions.installation_id = p_installation_id
        and (tokens.account_user_id is null
          or (tokens.account_user_id = p_user_id and tokens.account_session_id = p_session_id))), 0),
    coalesce((select max(account_mutation_version)
      from public.push_tokens
      where installation_id = p_installation_id
        and (account_user_id is null
          or (account_user_id = p_user_id and account_session_id = p_session_id))), 0)
  ) into v_version;
  if v_has_fence_rows and v_version >= 9007199254740991 then
    raise exception 'push mutation watermark exhausted';
  end if;
  v_authoritative := case when v_has_fence_rows
    then greatest(v_version + 1, p_mutation_version)
    else p_mutation_version end;
  insert into public.push_installation_account_revocations(installation_id, session_id, revoked_version, expires_at)
    values (p_installation_id, p_session_id, v_authoritative, now() + interval '30 days')
    on conflict (installation_id, session_id) do update set revoked_version = greatest(public.push_installation_account_revocations.revoked_version, excluded.revoked_version),
      expires_at = greatest(public.push_installation_account_revocations.expires_at, excluded.expires_at);
  insert into public.push_token_account_revocations(token, session_id, revoked_version, expires_at)
    select token, p_session_id, v_authoritative, now() + interval '30 days'
    from public.push_tokens where installation_id = p_installation_id
      and (account_user_id is null
        or (account_user_id = p_user_id and account_session_id = p_session_id))
    on conflict (token, session_id) do update set revoked_version = greatest(public.push_token_account_revocations.revoked_version, excluded.revoked_version),
      expires_at = greatest(public.push_token_account_revocations.expires_at, excluded.expires_at);
  insert into public.push_token_account_mutation_versions(token, installation_id, mutation_version, expires_at)
    select token, p_installation_id, v_authoritative, now() + interval '30 days'
    from public.push_tokens where installation_id = p_installation_id
      and (account_user_id is null
        or (account_user_id = p_user_id and account_session_id = p_session_id))
    on conflict (token, installation_id) do update set mutation_version = excluded.mutation_version,
      expires_at = excluded.expires_at;
  update public.push_tokens set account_user_id = null, account_session_id = null,
    account_installation_id = null, account_mutation_version = v_authoritative, account_linked_at = null
  where installation_id = p_installation_id and account_user_id = p_user_id
    and account_session_id = p_session_id;
  return v_authoritative;
end;
$$;

create or replace function public.unlink_all_push_tokens_for_account(
  p_user_id uuid, p_session_id uuid, p_installation_id uuid,
  p_mutation_version bigint
) returns bigint
language plpgsql security invoker set search_path = public
as $$
declare
  v_token public.push_tokens%rowtype;
  v_current bigint;
  v_authoritative bigint;
  v_returned bigint;
begin
  if p_user_id is null or p_session_id is null or p_installation_id is null
     or p_mutation_version is null or p_mutation_version <= 0
     or p_mutation_version > 9007199254740991 then
    raise exception 'invalid push identity mutation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('push-installation:' || p_installation_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('push-account-all:' || p_user_id::text, 0));
  -- Acquire every token lock before any matching row lock. The installation
  -- and account-wide locks keep the eligible set stable while we do so.
  for v_token in
    select * from public.push_tokens
    where account_user_id = p_user_id
      or (installation_id = p_installation_id and account_user_id is null)
    order by token
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'push-account:' || v_token.token || ':' || v_token.installation_id::text, 0
    ));
  end loop;

  -- Preflight every fence before any mutation so overflow rolls the whole
  -- account-erasure scope back rather than partially clearing it.
  for v_token in
    select * from public.push_tokens
    where account_user_id = p_user_id
      or (installation_id = p_installation_id and account_user_id is null)
    order by token
    for update
  loop
    select mutation_version into v_current
      from public.push_token_account_mutation_versions
      where token = v_token.token and installation_id = v_token.installation_id
      for update;
    v_current := greatest(
      coalesce(v_current, 0),
      case when v_token.account_installation_id = v_token.installation_id
        then coalesce(v_token.account_mutation_version, 0) else 0 end
    );
    if v_current >= 9007199254740991 then
      raise exception 'push mutation watermark exhausted';
    end if;
  end loop;

  v_returned := p_mutation_version;
  for v_token in
    select * from public.push_tokens
    where account_user_id = p_user_id
      or (installation_id = p_installation_id and account_user_id is null)
    order by token
    for update
  loop
    select mutation_version into v_current
      from public.push_token_account_mutation_versions
      where token = v_token.token and installation_id = v_token.installation_id
      for update;
    v_current := greatest(
      coalesce(v_current, 0),
      case when v_token.account_installation_id = v_token.installation_id
        then coalesce(v_token.account_mutation_version, 0) else 0 end
    );
    v_authoritative := greatest(
      v_current + 1,
      case when v_token.installation_id = p_installation_id
        then p_mutation_version else 1 end
    );
    v_returned := greatest(v_returned, v_authoritative);

    if v_token.account_user_id = p_user_id and v_token.account_session_id is not null then
      insert into public.push_token_account_revocations(token, session_id, revoked_version, expires_at)
        values (v_token.token, v_token.account_session_id, v_authoritative, now() + interval '30 days')
        on conflict (token, session_id) do update
          set revoked_version = greatest(public.push_token_account_revocations.revoked_version, excluded.revoked_version),
            expires_at = greatest(public.push_token_account_revocations.expires_at, excluded.expires_at);
      insert into public.push_installation_account_revocations(installation_id, session_id, revoked_version, expires_at)
        values (v_token.installation_id, v_token.account_session_id, v_authoritative, now() + interval '30 days')
        on conflict (installation_id, session_id) do update
          set revoked_version = greatest(public.push_installation_account_revocations.revoked_version, excluded.revoked_version),
            expires_at = greatest(public.push_installation_account_revocations.expires_at, excluded.expires_at);
    end if;
    if v_token.installation_id = p_installation_id then
      insert into public.push_token_account_revocations(token, session_id, revoked_version, expires_at)
        values (v_token.token, p_session_id, v_authoritative, now() + interval '30 days')
        on conflict (token, session_id) do update
          set revoked_version = greatest(public.push_token_account_revocations.revoked_version, excluded.revoked_version),
            expires_at = greatest(public.push_token_account_revocations.expires_at, excluded.expires_at);
      insert into public.push_installation_account_revocations(installation_id, session_id, revoked_version, expires_at)
        values (p_installation_id, p_session_id, v_authoritative, now() + interval '30 days')
        on conflict (installation_id, session_id) do update
          set revoked_version = greatest(public.push_installation_account_revocations.revoked_version, excluded.revoked_version),
            expires_at = greatest(public.push_installation_account_revocations.expires_at, excluded.expires_at);
    end if;
    insert into public.push_token_account_mutation_versions(token, installation_id, mutation_version, expires_at)
      values (v_token.token, v_token.installation_id, v_authoritative, now() + interval '30 days')
      on conflict (token, installation_id) do update
        set mutation_version = excluded.mutation_version, expires_at = excluded.expires_at;
    if v_token.account_user_id = p_user_id then
      update public.push_tokens set account_user_id = null, account_session_id = null,
        account_installation_id = null, account_mutation_version = v_authoritative,
        account_linked_at = null where token = v_token.token;
    end if;
  end loop;
  -- Even with no current token on the requesting installation, retain its
  -- session tombstone so a delayed register-then-link cannot recreate identity.
  insert into public.push_installation_account_revocations(installation_id, session_id, revoked_version, expires_at)
    values (p_installation_id, p_session_id, p_mutation_version, now() + interval '30 days')
    on conflict (installation_id, session_id) do update
      set revoked_version = greatest(public.push_installation_account_revocations.revoked_version, excluded.revoked_version),
        expires_at = greatest(public.push_installation_account_revocations.expires_at, excluded.expires_at);
  return v_returned;
end;
$$;

create or replace function public.link_push_token_plan_member_atomic(
  p_token text, p_plan_id uuid, p_member_id uuid, p_installation_id uuid,
  p_mutation_version bigint, p_linked_at timestamptz
) returns text
language plpgsql security invoker set search_path = public
as $$
declare v_link public.push_token_plan_memberships%rowtype; v_version bigint; v_had_link boolean;
begin
  if p_token is null or p_plan_id is null or p_member_id is null or p_installation_id is null
     or p_mutation_version is null or p_mutation_version <= 0
     or p_mutation_version > 9007199254740991 or p_linked_at is null then return 'missing'; end if;
  perform pg_advisory_xact_lock(hashtextextended('push-plan:' || p_token || ':' || p_installation_id::text || ':' || p_plan_id::text, 0));
  delete from public.push_token_plan_mutation_versions where expires_at <= now();
  perform 1 from public.push_tokens where token = p_token and installation_id = p_installation_id for update;
  if not found then return 'missing'; end if;
  perform 1 from public.plan_crew_members where id = p_member_id and plan_id = p_plan_id;
  if not found then return 'missing'; end if;
  select mutation_version into v_version from public.push_token_plan_mutation_versions
    where token = p_token and installation_id = p_installation_id and plan_id = p_plan_id for update;
  v_version := greatest(
    coalesce(v_version, 0),
    coalesce((select mutation_version from public.push_token_plan_memberships
      where token = p_token and plan_id = p_plan_id and installation_id = p_installation_id), 0)
  );
  select * into v_link from public.push_token_plan_memberships
    where token = p_token and plan_id = p_plan_id for update;
  v_had_link := found;
  if v_had_link and v_link.installation_id = p_installation_id then
    v_version := greatest(v_version, v_link.mutation_version);
  end if;
  if p_mutation_version < v_version then return 'stale'; end if;
  if p_mutation_version = v_version then
    if v_had_link and v_link.member_id = p_member_id and v_link.installation_id = p_installation_id
      then return 'replayed'; end if;
    return 'stale';
  end if;
  if v_had_link and v_link.member_id <> p_member_id then return 'conflict'; end if;
  insert into public.push_token_plan_mutation_versions(token, installation_id, plan_id, mutation_version, expires_at)
    values (p_token, p_installation_id, p_plan_id, p_mutation_version, now() + interval '30 days')
    on conflict (token, installation_id, plan_id) do update set mutation_version = excluded.mutation_version,
      expires_at = excluded.expires_at;
  insert into public.push_token_plan_memberships(token, plan_id, member_id, installation_id, mutation_version, linked_at)
    values (p_token, p_plan_id, p_member_id, p_installation_id, p_mutation_version, p_linked_at)
    on conflict (token, plan_id) do update set member_id = excluded.member_id,
      installation_id = excluded.installation_id, mutation_version = excluded.mutation_version,
      linked_at = excluded.linked_at;
  return case when v_had_link then 'replayed' else 'linked' end;
end;
$$;

create or replace function public.unlink_push_token_plan_member_atomic(
  p_token text, p_plan_id uuid, p_member_id uuid, p_installation_id uuid,
  p_mutation_version bigint
) returns bigint
language plpgsql security invoker set search_path = public
as $$
declare v_link public.push_token_plan_memberships%rowtype; v_version bigint; v_authoritative bigint;
begin
  if p_token is null or p_plan_id is null or p_member_id is null or p_installation_id is null
     or p_mutation_version is null or p_mutation_version <= 0
     or p_mutation_version > 9007199254740991 then
    raise exception 'invalid push identity mutation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('push-plan:' || p_token || ':' || p_installation_id::text || ':' || p_plan_id::text, 0));
  perform 1 from public.push_tokens where token = p_token and installation_id = p_installation_id for update;
  if not found then return p_mutation_version; end if;
  select * into v_link from public.push_token_plan_memberships
    where token = p_token and plan_id = p_plan_id for update;
  if found and v_link.member_id <> p_member_id then return p_mutation_version; end if;
  select mutation_version into v_version from public.push_token_plan_mutation_versions
    where token = p_token and installation_id = p_installation_id and plan_id = p_plan_id for update;
  v_version := greatest(
    coalesce(v_version, 0),
    coalesce((select mutation_version from public.push_token_plan_memberships
      where token = p_token and plan_id = p_plan_id and installation_id = p_installation_id), 0)
  );
  if v_version >= 9007199254740991 then
    raise exception 'push mutation watermark exhausted';
  end if;
  v_authoritative := greatest(v_version + 1, p_mutation_version);
  insert into public.push_token_plan_mutation_versions(token, installation_id, plan_id, mutation_version, expires_at)
    values (p_token, p_installation_id, p_plan_id, v_authoritative, now() + interval '30 days')
    on conflict (token, installation_id, plan_id) do update set mutation_version = excluded.mutation_version,
      expires_at = excluded.expires_at;
  delete from public.push_token_plan_memberships where token = p_token and plan_id = p_plan_id
    and member_id = p_member_id and installation_id = p_installation_id;
  return v_authoritative;
end;
$$;

revoke all on function public.register_push_token_installation_atomic(text, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.link_push_token_account_atomic(text, uuid, uuid, uuid, bigint, timestamptz) from public, anon, authenticated;
revoke all on function public.unlink_push_token_account_atomic(text, uuid, uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.unlink_push_installation_account_atomic(uuid, uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.unlink_all_push_tokens_for_account(uuid, uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.link_push_token_plan_member_atomic(text, uuid, uuid, uuid, bigint, timestamptz) from public, anon, authenticated;
revoke all on function public.unlink_push_token_plan_member_atomic(text, uuid, uuid, uuid, bigint) from public, anon, authenticated;

grant execute on function public.register_push_token_installation_atomic(text, text, uuid, timestamptz) to service_role;
grant execute on function public.link_push_token_account_atomic(text, uuid, uuid, uuid, bigint, timestamptz) to service_role;
grant execute on function public.unlink_push_token_account_atomic(text, uuid, uuid, uuid, bigint) to service_role;
grant execute on function public.unlink_push_installation_account_atomic(uuid, uuid, uuid, bigint) to service_role;
grant execute on function public.unlink_all_push_tokens_for_account(uuid, uuid, uuid, bigint) to service_role;
grant execute on function public.link_push_token_plan_member_atomic(text, uuid, uuid, uuid, bigint, timestamptz) to service_role;
grant execute on function public.unlink_push_token_plan_member_atomic(text, uuid, uuid, uuid, bigint) to service_role;
