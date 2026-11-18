-- 0247: a host marks who came to an open crew's night, and a moderator corrects it.
--
-- 1. social_crew_attendance is append-only. Each row is one revision of one accepted
--    participant's mark on one crew's night: subject, state ('attended' or 'absent'),
--    who recorded it (a host account, or a moderator's staff role with a reason), time
--    and revision. The highest revision is the current mark. No coordinates, venue,
--    purchase, price, receipt, photo or points. No browser or service role reads the
--    table; only these functions do.
-- 2. attest_social_crew_attendance_atomic: an active owner or co-host of an open crew
--    marks an active guest (role 'member'), never an owner, a co-host or themselves,
--    from London midnight on the night's day until start + 12 hours
--    (OPEN_CRAWL_ARRIVAL_CLOSE_MS in lib/nightWindows.ts). A cancelled night is closed.
--    A change names the current revision (0 for none) and gets 'stale' otherwise. The
--    same state is 'unchanged'. A block either way between host and guest, or a
--    suspended or deleted account, answers not_found like an unknown member.
-- 3. Writes use the Crew write receipts. A receipt that names a guest carries that
--    guest's auth user and the mark's expiry: it goes with the account deletion, and
--    the cleanup deletes it once expired. A replayed key passes every access check
--    again, after the same locks, before it returns its stored answer. Without access
--    it answers not_found, and after expiry 'closed'. It never writes.
-- 4. correct_social_crew_attendance_admin: an active moderator, with a 3 to 500
--    character reason, sets the mark of any member row of the crew (active, left or
--    removed) until it expires, also after the close, and never changes the member
--    row. A moderator with any member row in that crew, in any role or state, its
--    owner, anyone who marked in it, the participant, or the moderator whose mark an
--    open report disputes gets 'forbidden'. So a participant moderator never decides
--    that crew's disputes. A decision, a change or 'unchanged', closes the open
--    reports about that participant's marks in that crew.
-- 4a. report_social_crew_attendance: the participant reports their own current mark
--    by the revision they read, while they can read it. One report per revision; a
--    repeat answers 'reported', or 'decided' once a moderator has closed it. It does
--    not stop for a block or a Social freeze, like every report. It locks the crew row
--    first, as a correction does, so a moderator never decides a report filed mid-decision.
-- 4b. read_social_crew_attendance_reports_admin: an active moderator reads the open
--    reports they may decide, each with its crew, night, member, the disputed
--    revision, state, time and who recorded it (the host's handle, or the moderator's
--    display name), and the current revision to correct from. Reports a moderator may
--    not decide are left out.
-- 5. Lock order, the order admission uses (0245): crew row, the participant's auth row
--    (KEY SHARE), then participant-account locks in account-ID order. Blocks,
--    suspension and account deletion take the same account locks.
-- 6. Every row expires 30 days after the close. Reads, replays and the export deny
--    expired rows before any cleanup. purge_expired_social_crew_attendance deletes at
--    most 1,000 expired rows and 1,000 expired receipts per call. Nothing schedules it.
-- 7. A row goes with its crew, and with its participant's auth user in the same
--    transaction as that account deletion. A report goes with the mark it disputes.
--
-- Rollback drops the tables and functions, with every report, erases the attendance
-- receipts and drops the receipt columns. It stops while rows exist unless the session sets
-- pubmax.crew_attendance_discarded to the exact row count.
begin;

create table public.social_crew_attendance (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.social_crews(id) on delete cascade,
  subject_account_id uuid not null,
  subject_user_id uuid not null references auth.users(id) on delete cascade,
  revision integer not null check (revision >= 1),
  state text not null check (state in ('attended','absent')),
  actor_kind text not null check (actor_kind in ('host','moderator')),
  attester_account_id uuid,
  staff_role_id uuid,
  staff_display_name text check (char_length(staff_display_name) between 1 and 120),
  reason text check (char_length(reason) between 3 and 500),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (crew_id, subject_account_id, revision),
  check ((actor_kind='host' and attester_account_id is not null and staff_role_id is null and reason is null)
    or (actor_kind='moderator' and attester_account_id is null and staff_role_id is not null
      and staff_display_name is not null and reason is not null))
);
create index social_crew_attendance_subject_user_idx on public.social_crew_attendance (subject_user_id);
create index social_crew_attendance_expires_idx on public.social_crew_attendance (expires_at);
alter table public.social_crew_attendance enable row level security;
revoke all on table public.social_crew_attendance from public, anon, authenticated, service_role;

-- A participant's report that one revision of their mark is wrong. Open until a
-- moderator decides; it goes with the mark.
create table public.social_crew_attendance_reports (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null unique references public.social_crew_attendance(id) on delete cascade,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_staff_role_id uuid,
  check ((resolved_at is null) = (resolved_by_staff_role_id is null))
);
alter table public.social_crew_attendance_reports enable row level security;
revoke all on table public.social_crew_attendance_reports from public, anon, authenticated, service_role;

alter table public.private_social_crew_write_receipts
  add column subject_user_id uuid references auth.users(id) on delete cascade,
  add column expires_at timestamptz,
  add constraint private_social_crew_write_receipts_attendance_subject check (
    (subject_user_id is null and expires_at is null)
    or (operation like 'attendance:%' and subject_user_id is not null and expires_at is not null));
create index private_social_crew_write_receipts_subject_idx
  on public.private_social_crew_write_receipts (subject_user_id) where subject_user_id is not null;
create index private_social_crew_write_receipts_expires_idx
  on public.private_social_crew_write_receipts (expires_at) where expires_at is not null;

-- The night's attendance window from the crew's Plan. Null when there is no Plan.
create function public._social_crew_attendance_window(p_crew uuid,
  out opens_at timestamptz, out closes_at timestamptz, out expires_at timestamptz, out cancelled boolean)
language sql stable security definer set search_path=''
as $$
  select (pg_catalog.date_trunc('day', plan.start_time at time zone 'Europe/London') at time zone 'Europe/London'),
    plan.start_time + interval '12 hours',
    plan.start_time + interval '12 hours' + interval '30 days',
    plan.status = 'abandoned'
  from public.social_crews crew join public.plans plan on plan.id=crew.plan_id
  where crew.id=p_crew;
$$;

-- The current, unexpired mark: revision 0 and a null state when there is none.
create function public._social_crew_attendance_current(p_crew uuid,p_account uuid,
  out revision integer, out state text, out recorded_at timestamptz, out recorded_by text)
language sql stable security definer set search_path=''
as $$
  select coalesce(max(mark.revision),0),
    (array_agg(mark.state order by mark.revision desc))[1],
    (array_agg(mark.created_at order by mark.revision desc))[1],
    (array_agg(mark.actor_kind order by mark.revision desc))[1]
  from public.social_crew_attendance mark
  where mark.crew_id=p_crew and mark.subject_account_id=p_account and mark.expires_at > pg_catalog.statement_timestamp();
$$;

-- True when this active owner or co-host may mark this guest now. A new statement
-- each time, so it reads what committed while the locks waited.
create function public._social_crew_attendance_markable(p_crew uuid,p_actor uuid,p_subject uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select p_actor<>p_subject
    and exists(select 1 from public.social_crews where id=p_crew and visibility='open')
    and exists(select 1 from public.private_social_accounts where id=p_actor and ownership_state='active' and supabase_user_id is not null)
    and coalesce(public._social_crew_member_role(p_crew,p_actor),'') in ('owner','cohost')
    and exists(select 1 from public.social_crew_members member
      join public.private_social_accounts account on account.id=member.social_account_id
      where member.crew_id=p_crew and member.social_account_id=p_subject and member.state='active'
        and member.role='member' and account.ownership_state='active' and account.supabase_user_id is not null)
    and public._social_crew_relationship_between_accounts(p_actor,p_subject) is distinct from 'blocked';
$$;

-- True when this moderator profile may not decide this participant's marks in this
-- crew: any member row in it, in any role or state (roles change in place), its
-- owner, a host who marked in it, the participant, or the moderator whose mark an
-- open report disputes.
create function public._social_crew_attendance_moderator_conflicted(p_staff_profile uuid,p_crew uuid,p_subject uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select exists(select 1 from public.private_social_accounts staff_account
      where staff_account.profile_id=p_staff_profile and (
        staff_account.id=p_subject
        or exists(select 1 from public.social_crews crew where crew.id=p_crew and crew.owner_account_id=staff_account.id)
        or exists(select 1 from public.social_crew_members insider where insider.crew_id=p_crew
          and insider.social_account_id=staff_account.id)
        or exists(select 1 from public.social_crew_attendance mark where mark.crew_id=p_crew
          and mark.attester_account_id=staff_account.id)))
    or exists(select 1 from public.social_crew_attendance_reports report
      join public.social_crew_attendance mark on mark.id=report.attendance_id
      join public.private_social_staff_roles staff on staff.id=mark.staff_role_id
      where report.resolved_at is null and mark.crew_id=p_crew and mark.subject_account_id=p_subject
        and staff.profile_id=p_staff_profile);
$$;

-- Stores one attendance answer under its key. A receipt about a guest names them and
-- expires with the mark.
create function public._social_crew_attendance_finish(p_actor uuid,p_operation text,p_key text,p_digest text,
  p_response jsonb,p_subject_user uuid,p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  insert into public.private_social_crew_write_receipts(
    actor_account_id,operation,idempotency_key,payload_digest,response,subject_user_id,expires_at
  ) values(p_actor,p_operation,p_key,p_digest,p_response,p_subject_user,p_expires_at);
  return p_response;
end;
$$;

-- A refusal. A replay writes nothing, because its key already holds a receipt.
create function public._social_crew_attendance_refuse(p_replay boolean,p_actor uuid,p_operation text,p_key text,
  p_digest text,p_code text,p_subject_user uuid default null,p_expires_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  if p_replay then return jsonb_build_object('ok',false,'code',p_code); end if;
  return public._social_crew_attendance_finish(p_actor,p_operation,p_key,p_digest,
    jsonb_build_object('ok',false,'code',p_code),p_subject_user,p_expires_at);
end;
$$;

create function public.attest_social_crew_attendance_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_member_id uuid,p_state text,p_expected_revision integer,
  p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_operation text:='attendance:'||p_crew_id::text; v_replay jsonb; v_replaying boolean:=false;
  v_stored_expiry timestamptz; v_subject uuid; v_user uuid; v_window record; v_current record; v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest);
  if v_replay is not null then
    -- Without a stored receipt for this payload, the answer is an invalid key or a
    -- changed payload, and it discloses nothing about the guest.
    select receipt.expires_at into v_stored_expiry from public.private_social_crew_write_receipts receipt
    where receipt.actor_account_id=p_actor_account_id and receipt.operation=v_operation
      and receipt.idempotency_key=p_idempotency_key and receipt.payload_digest=p_payload_digest;
    if not found then return v_replay; end if;
    v_replaying:=true;
  elsif p_state is null or p_state not in ('attended','absent') or p_expected_revision is null or p_expected_revision<0 then
    return public._social_crew_attendance_refuse(false,p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'invalid');
  end if;
  perform 1 from public.social_crews where id=p_crew_id for update;
  if not found then
    return public._social_crew_attendance_refuse(v_replaying,p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found');
  end if;
  select member.social_account_id into v_subject from public.social_crew_members member
    where member.id=p_member_id and member.crew_id=p_crew_id;
  if v_subject is null or not public._social_crew_attendance_markable(p_crew_id,p_actor_account_id,v_subject) then
    return public._social_crew_attendance_refuse(v_replaying,p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found');
  end if;
  -- 0245's order: the guest's auth row, then both account locks in ID order. The auth
  -- row waits for an account deletion in flight, which also deletes this key's receipt.
  select account.supabase_user_id into v_user from public.private_social_accounts account where account.id=v_subject;
  perform 1 from auth.users where id=v_user for key share;
  if not found then
    return public._social_crew_attendance_refuse(v_replaying,p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found');
  end if;
  perform public._lock_social_participant_accounts(array[p_actor_account_id,v_subject]);
  if not public._social_crew_attendance_markable(p_crew_id,p_actor_account_id,v_subject) then
    return public._social_crew_attendance_refuse(v_replaying,p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found');
  end if;
  if v_replaying then
    if v_stored_expiry <= pg_catalog.statement_timestamp() then return jsonb_build_object('ok',false,'code','closed'); end if;
    return v_replay;
  end if;
  select * into v_window from public._social_crew_attendance_window(p_crew_id);
  if v_window.cancelled or pg_catalog.statement_timestamp() >= v_window.closes_at then
    return public._social_crew_attendance_refuse(false,p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,
      'closed',v_user,v_window.expires_at);
  end if;
  if pg_catalog.statement_timestamp() < v_window.opens_at then
    return public._social_crew_attendance_refuse(false,p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,
      'not_open',v_user,v_window.expires_at);
  end if;
  select * into v_current from public._social_crew_attendance_current(p_crew_id,v_subject);
  if v_current.revision<>p_expected_revision then
    return public._social_crew_attendance_refuse(false,p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,
      'stale',v_user,v_window.expires_at);
  end if;
  if v_current.state is not distinct from p_state then
    v_response:=jsonb_build_object('ok',true,'code','unchanged','revision',v_current.revision,'state',p_state);
  else
    insert into public.social_crew_attendance(crew_id,subject_account_id,subject_user_id,revision,state,actor_kind,attester_account_id,expires_at)
      values(p_crew_id,v_subject,v_user,v_current.revision+1,p_state,'host',p_actor_account_id,v_window.expires_at);
    v_response:=jsonb_build_object('ok',true,'code','attested','revision',v_current.revision+1,'state',p_state);
  end if;
  return public._social_crew_attendance_finish(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,
    v_response,v_user,v_window.expires_at);
end;
$$;

create function public.correct_social_crew_attendance_admin(
  p_staff_role_id uuid,p_crew_id uuid,p_member_id uuid,p_state text,p_expected_revision integer,p_reason text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_staff public.private_social_staff_roles; v_member public.social_crew_members;
  v_reason text:=btrim(coalesce(p_reason,'')); v_user uuid; v_window record; v_current record; v_audit uuid;
begin
  select * into v_staff from public.private_social_staff_roles
  where id=p_staff_role_id and active and revoked_at is null and role='moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  if char_length(v_reason) not between 3 and 500 or p_state is null or p_state not in ('attended','absent')
    or p_expected_revision is null or p_expected_revision<0 then
    return jsonb_build_object('ok',false,'code','invalid'); end if;
  perform 1 from public.social_crews where id=p_crew_id for update;
  if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
  -- Any member row: a removed guest's mark is corrected without reinstating them.
  select * into v_member from public.social_crew_members where id=p_member_id and crew_id=p_crew_id;
  if v_member.id is null then return jsonb_build_object('ok',false,'code','not_found'); end if;
  select account.supabase_user_id into v_user from public.private_social_accounts account where account.id=v_member.social_account_id;
  if v_user is null then return jsonb_build_object('ok',false,'code','gone'); end if;
  perform 1 from auth.users where id=v_user for key share;
  if not found then return jsonb_build_object('ok',false,'code','gone'); end if;
  perform public._lock_social_participant_accounts(array[v_member.social_account_id]);
  -- A participant never decides their own crew's dispute, nor a moderator their own
  -- disputed mark.
  if public._social_crew_attendance_moderator_conflicted(v_staff.profile_id,p_crew_id,v_member.social_account_id) then
    return jsonb_build_object('ok',false,'code','forbidden'); end if;
  select * into v_window from public._social_crew_attendance_window(p_crew_id);
  if pg_catalog.statement_timestamp() >= v_window.expires_at then
    return jsonb_build_object('ok',false,'code','expired'); end if;
  select * into v_current from public._social_crew_attendance_current(p_crew_id,v_member.social_account_id);
  if v_current.revision<>p_expected_revision then return jsonb_build_object('ok',false,'code','stale'); end if;
  -- The decision closes every open report about this participant's marks in this crew.
  update public.social_crew_attendance_reports report
  set resolved_at=pg_catalog.statement_timestamp(), resolved_by_staff_role_id=v_staff.id
  from public.social_crew_attendance mark
  where mark.id=report.attendance_id and mark.crew_id=p_crew_id
    and mark.subject_account_id=v_member.social_account_id and report.resolved_at is null;
  if v_current.state is not distinct from p_state then
    return jsonb_build_object('ok',true,'code','unchanged','revision',v_current.revision,'state',p_state); end if;
  insert into public.social_crew_attendance(crew_id,subject_account_id,subject_user_id,revision,state,actor_kind,
    staff_role_id,staff_display_name,reason,expires_at)
  values(p_crew_id,v_member.social_account_id,v_user,v_current.revision+1,p_state,'moderator',
    v_staff.id,v_staff.display_name,v_reason,v_window.expires_at)
  returning id into v_audit;
  return jsonb_build_object('ok',true,'code','corrected','revision',v_current.revision+1,'state',p_state,'auditId',v_audit);
end;
$$;

-- A host or co-host reads every member they may mark, unmarked ones with revision 0.
-- Any other member reads only their own mark. Anyone else reads null.
create function public.read_social_crew_attendance(
  p_viewer_account_id uuid,p_viewer_profile_id uuid,p_crew_id uuid
) returns jsonb language sql stable security definer set search_path=''
as $$
  with viewer as (
    select member.id as member_id,
      coalesce(public._social_crew_member_role(p_crew_id,p_viewer_account_id),'') in ('owner','cohost') as hosts
    from public.private_social_accounts account
    join public.social_crew_members member on member.social_account_id=account.id
      and member.crew_id=p_crew_id and member.state='active'
    join public.social_crews crew on crew.id=p_crew_id and crew.visibility='open'
    where account.id=p_viewer_account_id and account.profile_id=p_viewer_profile_id
      and account.ownership_state='active' and account.supabase_user_id is not null
  ), night as (select * from public._social_crew_attendance_window(p_crew_id))
  select jsonb_build_object(
    'canAttest', viewer.hosts,
    'open', not night.cancelled and pg_catalog.statement_timestamp() >= night.opens_at
      and pg_catalog.statement_timestamp() < night.closes_at,
    'opensAt', pg_catalog.to_char(night.opens_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'closesAt', pg_catalog.to_char(night.closes_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'memberId', member.id, 'state', mark.state, 'revision', mark.revision,
          'recordedAt', pg_catalog.to_char(mark.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'recordedBy', mark.recorded_by)
        order by member.joined_at, member.id)
      from public.social_crew_members member
      cross join lateral public._social_crew_attendance_current(p_crew_id,member.social_account_id) mark
      where member.crew_id=p_crew_id and member.state='active'
        and case when viewer.hosts
          then public._social_crew_attendance_markable(p_crew_id,p_viewer_account_id,member.social_account_id)
          else member.id=viewer.member_id and mark.revision>0 end
    ),'[]'::jsonb))
  from viewer, night;
$$;

-- The participant reports their own current mark, by the revision they read. Only
-- while they can read it: an active account and member of an open crew.
create function public.report_social_crew_attendance(
  p_viewer_account_id uuid,p_viewer_profile_id uuid,p_crew_id uuid,p_revision integer
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_mark public.social_crew_attendance; v_report public.social_crew_attendance_reports;
begin
  if p_revision is null or p_revision<1 then return jsonb_build_object('ok',false,'code','invalid'); end if;
  -- A decision holds the crew row from its conflict check until it commits, so a
  -- report waits for it and then reads the current mark.
  perform 1 from public.social_crews where id=p_crew_id for update;
  if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
  select mark.* into v_mark
  from public.private_social_accounts account
  join public.social_crew_members member on member.social_account_id=account.id
    and member.crew_id=p_crew_id and member.state='active'
  join public.social_crews crew on crew.id=p_crew_id and crew.visibility='open'
  join public.social_crew_attendance mark on mark.crew_id=p_crew_id and mark.subject_account_id=account.id
    and mark.expires_at > pg_catalog.statement_timestamp()
  where account.id=p_viewer_account_id and account.profile_id=p_viewer_profile_id
    and account.ownership_state='active' and account.supabase_user_id is not null
  order by mark.revision desc
  limit 1;
  if v_mark.id is null then return jsonb_build_object('ok',false,'code','not_found'); end if;
  if v_mark.revision<>p_revision then return jsonb_build_object('ok',false,'code','stale'); end if;
  insert into public.social_crew_attendance_reports(attendance_id) values(v_mark.id)
  on conflict (attendance_id) do nothing;
  select * into v_report from public.social_crew_attendance_reports where attendance_id=v_mark.id;
  return jsonb_build_object('ok',true,'code',case when v_report.resolved_at is null then 'reported' else 'decided' end,
    'revision',v_mark.revision);
end;
$$;

-- The open reports this moderator may decide, oldest first, with the disputed record.
create function public.read_social_crew_attendance_reports_admin(p_staff_role_id uuid,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_staff public.private_social_staff_roles;
begin
  if p_limit is null or p_limit<1 or p_limit>50 then raise exception 'invalid queue size'; end if;
  select * into v_staff from public.private_social_staff_roles
  where id=p_staff_role_id and active and revoked_at is null and role='moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  return coalesce((
    select jsonb_agg(item.entry order by item.created_at, item.id)
    from (
      select report.id, report.created_at, jsonb_build_object(
        'reportId', report.id,
        'reportedAt', pg_catalog.to_char(report.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'crewId', mark.crew_id,
        'nightStartsAt', pg_catalog.to_char(plan.start_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'memberId', member.id,
        'memberState', member.state,
        'subjectHandle', subject_profile.handle,
        'disputed', jsonb_build_object(
          'revision', mark.revision, 'state', mark.state, 'recordedBy', mark.actor_kind,
          'recordedAt', pg_catalog.to_char(mark.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'hostHandle', host_profile.handle, 'staffDisplayName', mark.staff_display_name),
        'current', jsonb_build_object('revision', current_mark.revision, 'state', current_mark.state),
        'expiresAt', pg_catalog.to_char(mark.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) as entry
      from public.social_crew_attendance_reports report
      join public.social_crew_attendance mark on mark.id=report.attendance_id
      join public.social_crew_members member on member.crew_id=mark.crew_id and member.social_account_id=mark.subject_account_id
      join public.social_crews crew on crew.id=mark.crew_id
      join public.plans plan on plan.id=crew.plan_id
      join public.private_social_accounts subject on subject.id=mark.subject_account_id
      join public.profiles subject_profile on subject_profile.id=subject.profile_id
      left join public.private_social_accounts host on host.id=mark.attester_account_id
      left join public.profiles host_profile on host_profile.id=host.profile_id
      cross join lateral public._social_crew_attendance_current(mark.crew_id,mark.subject_account_id) current_mark
      where report.resolved_at is null and mark.expires_at > pg_catalog.statement_timestamp()
        and not public._social_crew_attendance_moderator_conflicted(v_staff.profile_id,mark.crew_id,mark.subject_account_id)
      order by report.created_at, report.id
      limit p_limit
    ) item
  ), '[]'::jsonb);
end;
$$;

-- The account's own unexpired marks, without who recorded them or why, and when the
-- account reported one.
create function public.export_social_crew_attendance(p_user_id uuid,p_limit integer)
returns jsonb language sql stable security definer set search_path=''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', mark.id, 'crewId', mark.crew_id, 'subjectUserId', mark.subject_user_id, 'revision', mark.revision,
      'state', mark.state, 'recordedBy', mark.actor_kind,
      'recordedAt', pg_catalog.to_char(mark.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'expiresAt', pg_catalog.to_char(mark.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'reportedAt', pg_catalog.to_char(report.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    order by mark.created_at desc, mark.id),'[]'::jsonb)
  from (
    select * from public.social_crew_attendance
    where subject_user_id=p_user_id and expires_at > pg_catalog.statement_timestamp()
    order by created_at desc, id
    limit greatest(0,coalesce(p_limit,0))
  ) mark
  left join public.social_crew_attendance_reports report on report.attendance_id=mark.id;
$$;

create function public.purge_expired_social_crew_attendance(p_limit integer default 1000)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_limit integer:=greatest(1,least(coalesce(p_limit,1000),1000)); v_deleted integer; v_receipts integer;
begin
  with doomed as (
    select id from public.social_crew_attendance
    where expires_at <= pg_catalog.statement_timestamp()
    order by expires_at, id
    limit v_limit
    for update skip locked
  )
  delete from public.social_crew_attendance mark using doomed where mark.id=doomed.id;
  get diagnostics v_deleted = row_count;
  with doomed as (
    select actor_account_id, operation, idempotency_key from public.private_social_crew_write_receipts
    where expires_at <= pg_catalog.statement_timestamp()
    order by expires_at
    limit v_limit
    for update skip locked
  )
  delete from public.private_social_crew_write_receipts receipt using doomed
  where receipt.actor_account_id=doomed.actor_account_id and receipt.operation=doomed.operation
    and receipt.idempotency_key=doomed.idempotency_key;
  get diagnostics v_receipts = row_count;
  return jsonb_build_object('ok',true,'deleted',v_deleted,'receipts',v_receipts);
end;
$$;

revoke all on function public._social_crew_attendance_window(uuid) from public, anon, authenticated, service_role;
revoke all on function public._social_crew_attendance_current(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public._social_crew_attendance_markable(uuid,uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public._social_crew_attendance_moderator_conflicted(uuid,uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public._social_crew_attendance_finish(uuid,text,text,text,jsonb,uuid,timestamptz) from public, anon, authenticated, service_role;
revoke all on function public._social_crew_attendance_refuse(boolean,uuid,text,text,text,text,uuid,timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.attest_social_crew_attendance_atomic(uuid,uuid,uuid,text,integer,text,text) from public, anon, authenticated;
revoke all on function public.correct_social_crew_attendance_admin(uuid,uuid,uuid,text,integer,text) from public, anon, authenticated;
revoke all on function public.read_social_crew_attendance(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.report_social_crew_attendance(uuid,uuid,uuid,integer) from public, anon, authenticated;
revoke all on function public.read_social_crew_attendance_reports_admin(uuid,integer) from public, anon, authenticated;
revoke all on function public.export_social_crew_attendance(uuid,integer) from public, anon, authenticated;
revoke all on function public.purge_expired_social_crew_attendance(integer) from public, anon, authenticated;
grant execute on function public.attest_social_crew_attendance_atomic(uuid,uuid,uuid,text,integer,text,text) to service_role;
grant execute on function public.correct_social_crew_attendance_admin(uuid,uuid,uuid,text,integer,text) to service_role;
grant execute on function public.read_social_crew_attendance(uuid,uuid,uuid) to service_role;
grant execute on function public.report_social_crew_attendance(uuid,uuid,uuid,integer) to service_role;
grant execute on function public.read_social_crew_attendance_reports_admin(uuid,integer) to service_role;
grant execute on function public.export_social_crew_attendance(uuid,integer) to service_role;
grant execute on function public.purge_expired_social_crew_attendance(integer) to service_role;

commit;
