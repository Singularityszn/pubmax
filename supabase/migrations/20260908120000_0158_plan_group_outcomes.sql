-- M1: private completion-time account snapshots and a 28-day group aggregate.
-- No historical roster backfill. Account deletion clears comparison identity.
begin;

create table public.plan_group_outcome_capture (
  version smallint primary key check (version = 1),
  started_at timestamptz not null
);
insert into public.plan_group_outcome_capture values (1, clock_timestamp());

-- No production specification or account classification is supplied here.
-- Only the database owner may register reviewed internal evidence. The app
-- can neither approve a policy nor turn a query argument into evidence.
create table public.plan_group_outcome_specifications (
  reference text primary key check (length(trim(reference)) > 0),
  authority_reference text not null check (length(trim(authority_reference)) > 0),
  approved_at timestamptz not null check (isfinite(approved_at)),
  effective_from timestamptz not null check (isfinite(effective_from)),
  effective_until timestamptz not null check (isfinite(effective_until)),
  mixed_roster_policy text not null check (mixed_roster_policy in ('exclude_outing', 'eligible_accounts_only')),
  london_scope_rule text not null check (london_scope_rule = 'all_stops_london'),
  check (approved_at <= effective_from and effective_from < effective_until)
);
create table public.plan_group_outcome_classifications (
  id bigint generated always as identity primary key,
  specification_reference text not null references public.plan_group_outcome_specifications(reference),
  user_id uuid references auth.users(id) on delete set null,
  eligible boolean not null,
  evidence_reference text not null check (length(trim(evidence_reference)) > 0),
  recorded_at timestamptz not null check (isfinite(recorded_at)),
  effective_from timestamptz not null check (isfinite(effective_from)),
  effective_until timestamptz not null check (isfinite(effective_until)),
  check (recorded_at <= effective_from and effective_from < effective_until)
);
create index plan_group_outcome_classification_user_idx
  on public.plan_group_outcome_classifications(specification_reference,user_id) where user_id is not null;

create table public.plan_group_outcomes (
  completion_id uuid primary key references public.plan_completions(id) on delete cascade,
  snapshot_version smallint not null default 1 check (snapshot_version = 1),
  environment text check (environment in ('production','preview','development','internal-test')),
  release text check (release ~ '^[0-9a-f]{7}$'),
  participant_count integer not null check (participant_count >= 0),
  eligible_account_count integer check (eligible_account_count between 0 and participant_count),
  specification_reference text references public.plan_group_outcome_specifications(reference),
  cohort_eligibility text not null check (cohort_eligibility in ('qualified','excluded','unknown')),
  route_scope text not null check (route_scope in ('london','other_city','mixed','unknown')),
  check (cohort_eligibility <> 'qualified' or (
    eligible_account_count is not null and eligible_account_count >= 2 and specification_reference is not null
    and environment is not null and environment = 'production' and route_scope = 'london'))
);
create table public.plan_group_outcome_accounts (
  completion_id uuid not null references public.plan_group_outcomes(completion_id) on delete cascade,
  position integer not null check (position >= 1),
  user_id uuid references auth.users(id) on delete set null,
  eligible boolean,
  primary key (completion_id, position),
  unique (completion_id, user_id)
);
create index plan_group_outcome_accounts_user_idx
  on public.plan_group_outcome_accounts(user_id, completion_id) where user_id is not null;
create index plan_group_outcomes_completed_at_idx on public.plan_completions(completed_at);

create function public._0158_preserve_used_group_specification()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.plan_group_outcomes where specification_reference = old.reference) then
    raise exception 'A captured cohort specification cannot change' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger plan_group_outcome_specification_immutable
  before update on public.plan_group_outcome_specifications
  for each row execute function public._0158_preserve_used_group_specification();
revoke all on function public._0158_preserve_used_group_specification() from public, anon, authenticated, service_role;

alter table public.plan_group_outcome_capture enable row level security;
alter table public.plan_group_outcomes enable row level security;
alter table public.plan_group_outcome_accounts enable row level security;
alter table public.plan_group_outcome_specifications enable row level security;
alter table public.plan_group_outcome_classifications enable row level security;
revoke all on public.plan_group_outcome_capture, public.plan_group_outcomes,
  public.plan_group_outcome_accounts, public.plan_group_outcome_specifications,
  public.plan_group_outcome_classifications from public, anon, authenticated, service_role;
revoke all on sequence public.plan_group_outcome_classifications_id_seq from public, anon, authenticated, service_role;
grant select on public.plan_group_outcome_capture, public.plan_group_outcomes,
  public.plan_group_outcome_accounts, public.plan_group_outcome_specifications to service_role;

-- Only the completion wrappers call this owner-only helper. Their Plan row
-- lock remains held until the snapshot and completion commit together.
create function public._0158_capture_plan_group_outcome(
  p_plan_id uuid, p_environment text, p_release text, p_route_scope text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_completion_id uuid;
  v_accounts uuid[];
  v_completed_at timestamptz;
  v_spec public.plan_group_outcome_specifications%rowtype;
  v_spec_count integer;
  v_spec_reference text;
  v_known integer;
  v_eligible integer;
  v_test integer;
  v_eligibility text := 'unknown';
begin
  select id, completed_at into strict v_completion_id, v_completed_at
    from public.plan_completions where plan_id = p_plan_id;
  -- Lock participating rows against a concurrent claim/revocation. Guest seats
  -- count only if an account is bound when this transaction takes the snapshot.
  select coalesce(array_agg(distinct m.user_id order by m.user_id), '{}'::uuid[])
    into v_accounts
    from (select user_id, membership_revoked_at from public.plan_crew_members
      where plan_id = p_plan_id
      for share) m
    where m.user_id is not null and m.membership_revoked_at is null;
  -- Lock the applicable specification rows. Do not lock the classification
  -- table: unrelated account deletion must not wait behind every completion.
  select count(*), min(reference) into v_spec_count, v_spec_reference from (
    select reference from public.plan_group_outcome_specifications
    where effective_from <= v_completed_at and effective_until > v_completed_at for share
  ) applicable;
  if v_spec_count = 1 then
    select * into strict v_spec from public.plan_group_outcome_specifications
      where reference = v_spec_reference;
  end if;
  insert into public.plan_group_outcomes(completion_id, environment, release, participant_count,
    specification_reference, cohort_eligibility, route_scope)
    values (v_completion_id, p_environment, p_release, cardinality(v_accounts),
      v_spec.reference, 'unknown', p_route_scope);
  insert into public.plan_group_outcome_accounts(completion_id, position, user_id)
    select v_completion_id, ordinal::integer, account_id
    from unnest(v_accounts) with ordinality as accounts(account_id, ordinal);
  -- One statement reads all classification evidence at one database snapshot.
  -- Missing or overlapping evidence is unknown, never eligible by absence.
  update public.plan_group_outcome_accounts a set eligible = (
    select case when count(*) = 1 then bool_and(c.eligible) else null end
    from public.plan_group_outcome_classifications c
    where c.specification_reference = v_spec.reference and c.user_id = a.user_id
      and c.effective_from <= v_completed_at and c.effective_until > v_completed_at
  ) where a.completion_id = v_completion_id;
  select count(eligible), count(*) filter (where eligible), count(*) filter (where eligible = false)
    into v_known, v_eligible, v_test
    from public.plan_group_outcome_accounts where completion_id = v_completion_id;
  -- A captured zero/one-account outing cannot qualify, including legacy callers.
  if cardinality(v_accounts) < 2 or p_environment <> 'production' or p_route_scope = 'other_city' then
    v_eligibility := 'excluded';
  elsif v_spec.reference is not null then
    if v_spec.mixed_roster_policy = 'exclude_outing' and v_test > 0 then
      v_eligibility := 'excluded';
    elsif v_known = cardinality(v_accounts) and v_eligible < 2 then
      v_eligibility := 'excluded';
    elsif v_known = cardinality(v_accounts) and p_environment = 'production' and p_route_scope = 'london' then
      v_eligibility := 'qualified';
    end if;
  end if;
  update public.plan_group_outcomes set cohort_eligibility = v_eligibility,
    eligible_account_count = case when v_known = cardinality(v_accounts) then v_eligible else null end
    where completion_id = v_completion_id;
end;
$$;
revoke all on function public._0158_capture_plan_group_outcome(uuid,text,text,text)
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
    perform public._0158_capture_plan_group_outcome(p_plan_id, null, null, 'unknown');
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
    perform public._0158_capture_plan_group_outcome(p_plan_id, null, null, 'unknown');
  end if;
  return v_result;
end;
$$;

create function public.complete_plan_with_group_outcome_atomic(
  p_plan_id uuid, p_token_hash text, p_expected_route_revision integer,
  p_completion_id uuid, p_action_id uuid, p_ending text,
  p_terminal_venue_id text, p_ending_selection jsonb, p_completed_at timestamptz,
  p_environment text, p_release text, p_route_scope text, p_scope_route_revision integer,
  p_scope_venue_ids text[]
) returns text language plpgsql security definer set search_path = '' as $$
declare v_result text;
begin
  v_result := public._0158_complete_plan_atomic_9($1,$2,$3,$4,$5,$6,$7,$8,$9);
  if v_result = 'completed' then
    perform public._0158_capture_plan_group_outcome(p_plan_id, p_environment, p_release,
      case when p_scope_route_revision = p_expected_route_revision and p_scope_venue_ids = (
        select array_agg(stop->>'venueId' order by ordinal)
        from public.plan_completions c,
          jsonb_array_elements(c.route_snapshot) with ordinality as stops(stop, ordinal)
        where c.plan_id = p_plan_id
      ) then p_route_scope else 'unknown' end);
  end if;
  return v_result;
end;
$$;

revoke all on function public.complete_plan_atomic(uuid,text,integer,uuid,uuid,text,text,timestamptz),
  public.complete_plan_atomic(uuid,text,integer,uuid,uuid,text,text,jsonb,timestamptz),
  public.complete_plan_with_group_outcome_atomic(uuid,text,integer,uuid,uuid,text,text,jsonb,timestamptz,text,text,text,integer,text[])
  from public, anon, authenticated;
grant execute on function public.complete_plan_atomic(uuid,text,integer,uuid,uuid,text,text,timestamptz),
  public.complete_plan_atomic(uuid,text,integer,uuid,uuid,text,text,jsonb,timestamptz),
  public.complete_plan_with_group_outcome_atomic(uuid,text,integer,uuid,uuid,text,text,jsonb,timestamptz,text,text,text,integer,text[])
  to service_role;

-- A reference selects owner-approved evidence. It does not create evidence.
-- No default production policy or population is inferred by this read.
create function public.read_plan_group_outcomes(
  p_from timestamptz, p_until timestamptz, p_specification_reference text default null
) returns table (
  week_start date, status text, groups_completed bigint, groups_repeated bigint,
  repeat_rate double precision, unresolved_completions bigint, capture_started_at timestamptz
) language plpgsql stable security invoker set search_path = '' as $$
declare
  v_capture_start timestamptz;
  v_spec public.plan_group_outcome_specifications%rowtype;
begin
  if p_from is null or p_until is null or not isfinite(p_from) or not isfinite(p_until)
    or p_from >= p_until then
    raise exception 'Invalid group outcome window' using errcode = '22023';
  end if;
  select started_at into strict v_capture_start from public.plan_group_outcome_capture where version = 1;
  select * into v_spec from public.plan_group_outcome_specifications where reference = p_specification_reference;
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
    select c.id, c.completed_at, o.eligible_account_count,
      case
        when o.participant_count < 2 or o.environment <> 'production' or o.route_scope = 'other_city' then 'excluded'
        when o.completion_id is null or o.environment is null then 'unknown'
        when o.specification_reference is distinct from v_spec.reference then 'unknown'
        else o.cohort_eligibility
      end as eligibility,
      (select count(*) from public.plan_group_outcome_accounts a
        where a.completion_id = c.id and a.eligible and a.user_id is null) as lost_identity
    from public.plan_completions c
    left join public.plan_group_outcomes o on o.completion_id = c.id
    where c.completed_at >= p_from - interval '672 hours' and c.completed_at < p_until
  ), comparisons as materialized (
    -- Deletion clears an account everywhere. A hidden match therefore needs
    -- a cleared eligible position on BOTH sides, never a surviving identity.
    select c.id, prior.id as prior_id, least(c.lost_identity, prior.lost_identity) as possible_hidden_matches,
      least(c.eligible_account_count, prior.eligible_account_count) as possible_accounts,
      (select count(*) from public.plan_group_outcome_accounts a
        join public.plan_group_outcome_accounts b on b.user_id = a.user_id
        where a.completion_id = c.id and b.completion_id = prior.id and a.eligible and b.eligible) as shared
    from observations c join observations prior
      on prior.completed_at < c.completed_at
      and prior.completed_at >= c.completed_at - interval '672 hours'
    where c.eligibility = 'qualified' and prior.eligibility = 'qualified'
      and c.lost_identity > 0 and prior.lost_identity > 0
  ), repeated as (
    select distinct c.id from observations c
    join public.plan_group_outcome_accounts a on a.completion_id = c.id and a.eligible
    join public.plan_group_outcome_accounts b on b.user_id = a.user_id and b.eligible
    join observations prior on prior.id = b.completion_id and prior.eligibility = 'qualified'
      and prior.completed_at < c.completed_at
      and prior.completed_at >= c.completed_at - interval '672 hours'
    where c.eligibility = 'qualified'
    group by c.id, prior.id having count(*) >= 2
  ), uncertain_targets as (
    select c.id from observations c
    where c.eligibility = 'qualified' and not exists (select 1 from repeated r where r.id = c.id)
      and (
        exists (select 1 from comparisons pair where pair.id = c.id
          and least(pair.possible_accounts, pair.shared + pair.possible_hidden_matches) >= 2)
        or exists (select 1 from observations prior where prior.eligibility = 'unknown'
          and prior.completed_at < c.completed_at and prior.completed_at >= c.completed_at - interval '672 hours')
      )
  ), counts as (
    select w.*,
      (select count(*) from observations o where o.eligibility = 'qualified'
        and o.completed_at >= w.window_start and o.completed_at < w.window_end) as completed,
      (select count(*) from observations o join repeated r on r.id = o.id
        where o.completed_at >= w.window_start and o.completed_at < w.window_end) as repeats,
      (select count(*) from observations o where
        (o.eligibility = 'unknown' and o.completed_at >= w.window_start - interval '672 hours'
          or o.id in (select id from uncertain_targets) and o.completed_at >= w.window_start)
        and o.completed_at < w.window_end) as unresolved,
      -- Empty intervals still require capture and classification coverage.
      w.window_start - interval '672 hours' >= v_capture_start
        and w.window_start - interval '672 hours' >= v_spec.effective_from
        and w.window_end <= v_spec.effective_until
        and w.window_end <= statement_timestamp()
        and not exists (select 1 from public.plan_group_outcome_specifications other
          where other.reference <> v_spec.reference and other.effective_from < w.window_end
            and other.effective_until > w.window_start - interval '672 hours') as covered
    from weeks w
  ), labelled as (
    select c.*,
      case when v_spec.reference is null then 'cohort_unresolved'
        when c.unresolved > 0 or c.covered is not true then 'partial'
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
revoke all on function public.read_plan_group_outcomes(timestamptz,timestamptz,text)
  from public, anon, authenticated;
grant execute on function public.read_plan_group_outcomes(timestamptz,timestamptz,text) to service_role;
commit;
