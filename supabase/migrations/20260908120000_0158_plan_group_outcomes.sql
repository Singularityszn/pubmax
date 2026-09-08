-- M1: private completion-time account snapshots and a 28-day group aggregate.
-- No historical roster backfill. Account deletion clears comparison identity.
begin;

create table public.plan_group_outcome_capture (
  version smallint primary key check (version = 1),
  started_at timestamptz not null
);
insert into public.plan_group_outcome_capture values (1, clock_timestamp());

create table public.plan_group_outcomes (
  completion_id uuid primary key references public.plan_completions(id) on delete cascade,
  snapshot_version smallint not null default 1 check (snapshot_version = 1),
  environment text check (environment in ('production','preview','development','internal-test')),
  release text check (release ~ '^[0-9a-f]{7}$'),
  participant_count integer not null check (participant_count >= 0)
);
create table public.plan_group_outcome_accounts (
  completion_id uuid not null references public.plan_group_outcomes(completion_id) on delete cascade,
  position integer not null check (position >= 1),
  user_id uuid references auth.users(id) on delete set null,
  primary key (completion_id, position),
  unique (completion_id, user_id)
);
create index plan_group_outcome_accounts_user_idx
  on public.plan_group_outcome_accounts(user_id, completion_id) where user_id is not null;
create index plan_group_outcomes_completed_at_idx on public.plan_completions(completed_at);

alter table public.plan_group_outcome_capture enable row level security;
alter table public.plan_group_outcomes enable row level security;
alter table public.plan_group_outcome_accounts enable row level security;
revoke all on public.plan_group_outcome_capture, public.plan_group_outcomes,
  public.plan_group_outcome_accounts from public, anon, authenticated, service_role;
grant select on public.plan_group_outcome_capture, public.plan_group_outcomes,
  public.plan_group_outcome_accounts to service_role;

-- Only the completion wrappers call this owner-only helper. Their Plan row
-- lock remains held until the snapshot and completion commit together.
create function public._0158_capture_plan_group_outcome(
  p_plan_id uuid, p_environment text, p_release text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_completion_id uuid;
  v_accounts uuid[];
begin
  select id into strict v_completion_id from public.plan_completions where plan_id = p_plan_id;
  -- Lock participating rows against a concurrent claim/revocation. Guest seats
  -- count only if an account is bound when this transaction takes the snapshot.
  select coalesce(array_agg(distinct m.user_id order by m.user_id), '{}'::uuid[])
    into v_accounts
    from (select user_id, membership_revoked_at from public.plan_crew_members
      where plan_id = p_plan_id
      for share) m
    where m.user_id is not null and m.membership_revoked_at is null;
  insert into public.plan_group_outcomes(completion_id, environment, release, participant_count)
    values (v_completion_id, p_environment, p_release, cardinality(v_accounts));
  insert into public.plan_group_outcome_accounts(completion_id, position, user_id)
    select v_completion_id, ordinal::integer, account_id
    from unnest(v_accounts) with ordinality as accounts(account_id, ordinal);
end;
$$;
revoke all on function public._0158_capture_plan_group_outcome(uuid,text,text)
  from public, anon, authenticated, service_role;

-- Retain the exact existing authorization, arrival and Social guards behind
-- both overloads. Renaming keeps their bodies available for exact rollback.
alter function public.complete_plan_atomic(uuid,text,integer,uuid,uuid,text,text,timestamptz)
  rename to _0158_complete_plan_atomic_8;
alter function public.complete_plan_atomic(uuid,text,integer,uuid,uuid,text,text,jsonb,timestamptz)
  rename to _0158_complete_plan_atomic_9;
revoke all on function public._0158_complete_plan_atomic_8(uuid,text,integer,uuid,uuid,text,text,timestamptz),
  public._0158_complete_plan_atomic_9(uuid,text,integer,uuid,uuid,text,text,jsonb,timestamptz)
  from public, anon, authenticated, service_role;

create function public.complete_plan_atomic(
  p_plan_id uuid, p_token_hash text, p_expected_route_revision integer,
  p_completion_id uuid, p_action_id uuid, p_ending text,
  p_terminal_venue_id text, p_completed_at timestamptz
) returns text language plpgsql security definer set search_path = '' as $$
declare v_result text;
begin
  v_result := public._0158_complete_plan_atomic_8($1,$2,$3,$4,$5,$6,$7,$8);
  if v_result = 'completed' then
    perform public._0158_capture_plan_group_outcome(p_plan_id, null, null);
  end if;
  return v_result;
end;
$$;

create function public.complete_plan_atomic(
  p_plan_id uuid, p_token_hash text, p_expected_route_revision integer,
  p_completion_id uuid, p_action_id uuid, p_ending text,
  p_terminal_venue_id text, p_ending_selection jsonb, p_completed_at timestamptz
) returns text language plpgsql security definer set search_path = '' as $$
declare v_result text;
begin
  v_result := public._0158_complete_plan_atomic_9($1,$2,$3,$4,$5,$6,$7,$8,$9);
  if v_result = 'completed' then
    perform public._0158_capture_plan_group_outcome(p_plan_id, null, null);
  end if;
  return v_result;
end;
$$;

create function public.complete_plan_with_group_outcome_atomic(
  p_plan_id uuid, p_token_hash text, p_expected_route_revision integer,
  p_completion_id uuid, p_action_id uuid, p_ending text,
  p_terminal_venue_id text, p_ending_selection jsonb, p_completed_at timestamptz,
  p_environment text, p_release text
) returns text language plpgsql security definer set search_path = '' as $$
declare v_result text;
begin
  v_result := public._0158_complete_plan_atomic_9($1,$2,$3,$4,$5,$6,$7,$8,$9);
  if v_result = 'completed' then
    perform public._0158_capture_plan_group_outcome(p_plan_id, p_environment, p_release);
  end if;
  return v_result;
end;
$$;

revoke all on function public.complete_plan_atomic(uuid,text,integer,uuid,uuid,text,text,timestamptz),
  public.complete_plan_atomic(uuid,text,integer,uuid,uuid,text,text,jsonb,timestamptz),
  public.complete_plan_with_group_outcome_atomic(uuid,text,integer,uuid,uuid,text,text,jsonb,timestamptz,text,text)
  from public, anon, authenticated;
grant execute on function public.complete_plan_atomic(uuid,text,integer,uuid,uuid,text,text,timestamptz),
  public.complete_plan_atomic(uuid,text,integer,uuid,uuid,text,text,jsonb,timestamptz),
  public.complete_plan_with_group_outcome_atomic(uuid,text,integer,uuid,uuid,text,text,jsonb,timestamptz,text,text)
  to service_role;

-- The caller must supply a reviewed, complete test-account exclusion list and
-- its internal specification reference. NULL is unresolved; [] is an explicit
-- assertion from that specification, never a default. Any excluded account
-- excludes the whole outing, in both the current and preceding cohorts.
create function public.read_plan_group_outcomes(
  p_from timestamptz, p_until timestamptz,
  p_excluded_user_ids uuid[] default null, p_exclusion_specification text default null
) returns table (
  week_start date, status text, groups_completed bigint, groups_repeated bigint,
  repeat_rate double precision, unresolved_completions bigint, capture_started_at timestamptz
) language plpgsql stable security invoker set search_path = '' as $$
declare v_capture_start timestamptz;
begin
  if p_from is null or p_until is null or not isfinite(p_from) or not isfinite(p_until)
    or p_from >= p_until then
    raise exception 'Invalid group outcome window' using errcode = '22023';
  end if;
  select started_at into strict v_capture_start from public.plan_group_outcome_capture where version = 1;
  return query
  with weeks as (
    select day::date as week,
      greatest(p_from, day at time zone 'Europe/London') as window_start,
      least(p_until, (day + interval '7 days') at time zone 'Europe/London') as window_end
    from generate_series(
      date_trunc('week', p_from at time zone 'Europe/London'),
      date_trunc('week', p_until at time zone 'Europe/London'), interval '7 days'
    ) as series(day)
    where day at time zone 'Europe/London' < p_until
  ), observations as materialized (
    select c.id, c.completed_at,
      case
        when o.completion_id is null or o.environment is null then 'unknown'
        when o.environment <> 'production' or o.participant_count < 2 then 'excluded'
        when exists (select 1 from public.plan_group_outcome_accounts a
          where a.completion_id = c.id and a.user_id = any(p_excluded_user_ids)) then 'excluded'
        when (select count(*) from public.plan_group_outcome_accounts a
          where a.completion_id = c.id and a.user_id is not null) <> o.participant_count then 'unknown'
        else 'qualified'
      end as eligibility
    from public.plan_completions c
    left join public.plan_group_outcomes o on o.completion_id = c.id
    where c.completed_at >= p_from - interval '672 hours' and c.completed_at < p_until
  ), repeated as (
    select distinct c.id from observations c
    join public.plan_group_outcome_accounts a on a.completion_id = c.id
    join public.plan_group_outcome_accounts b on b.user_id = a.user_id
    join observations prior on prior.id = b.completion_id
      and prior.eligibility = 'qualified' and prior.id <> c.id
      and prior.completed_at < c.completed_at
      and prior.completed_at >= c.completed_at - interval '672 hours'
    where c.eligibility = 'qualified'
    group by c.id, prior.id having count(*) >= 2
  ), counts as (
    select w.*,
      (select count(*) from observations o where o.eligibility = 'qualified'
        and o.completed_at >= w.window_start and o.completed_at < w.window_end) as completed,
      (select count(*) from observations o join repeated r on r.id = o.id
        where o.completed_at >= w.window_start and o.completed_at < w.window_end) as repeats,
      (select count(*) from observations o where o.eligibility = 'unknown'
        and o.completed_at >= w.window_start - interval '672 hours'
        and o.completed_at < w.window_end) as unresolved
    from weeks w
  ), labelled as (
    select c.*,
      case
        when p_excluded_user_ids is null or array_position(p_excluded_user_ids, null) is not null
          or nullif(trim(p_exclusion_specification), '') is null then 'cohort_unresolved'
        when c.unresolved > 0 or c.window_start - interval '672 hours' < v_capture_start
          or c.window_end > statement_timestamp() then 'partial'
        else 'ready'
      end as result_status
    from counts c
  )
  select l.week, l.result_status,
    case when l.result_status = 'cohort_unresolved' then null else l.completed end,
    case when l.result_status = 'cohort_unresolved' then null else l.repeats end,
    case when l.result_status = 'ready' and l.completed > 0 then l.repeats::double precision / l.completed else null end,
    l.unresolved, v_capture_start
  from labelled l order by l.week;
end;
$$;
revoke all on function public.read_plan_group_outcomes(timestamptz,timestamptz,uuid[],text)
  from public, anon, authenticated;
grant execute on function public.read_plan_group_outcomes(timestamptz,timestamptz,uuid[],text) to service_role;
commit;
