-- PROVISIONAL 0202. The captain applies this migration and its rollback.
begin;

create table public.hosted_outings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 80),
  venue_id text not null check (char_length(venue_id) between 1 and 120),
  venue_name text not null check (char_length(venue_name) between 1 and 120),
  starts_at timestamptz not null,
  capacity integer not null check (capacity between 2 and 12),
  status text not null default 'draft' check (status in ('draft','open','cancelled','completed')),
  operator_profile_id uuid references public.profiles(id) on delete set null,
  moderator_staff_id uuid references public.private_social_staff_roles(id) on delete set null,
  venue_confirmation text check (char_length(venue_confirmation) between 1 and 500),
  enrollment_enabled boolean not null default false,
  group_explanation text check (char_length(group_explanation)<=1000),
  group_budget_pence integer check (group_budget_pence between 0 and 100000),
  announcement text not null default '' check (char_length(announcement) <= 2000),
  revision integer not null default 0,
  created_at timestamptz not null default now()
);
create index hosted_outings_moderator_idx on public.hosted_outings(moderator_staff_id);
create index hosted_outings_operator_idx on public.hosted_outings(operator_profile_id);

create table public.hosted_outing_attendees (
  outing_id uuid not null references public.hosted_outings(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  state text not null default 'waiting' check (state in ('waiting','approved','confirmed','cancelled')),
  pace text not null check (pace in ('easy','steady')),
  budget_pence integer not null check (budget_pence between 0 and 100000),
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (outing_id,profile_id)
);
create index hosted_outing_attendees_user_idx on public.hosted_outing_attendees(user_id);
create index hosted_outing_attendees_profile_idx on public.hosted_outing_attendees(profile_id);

create table public.hosted_outing_reports (
  outing_id uuid not null references public.hosted_outings(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  status text not null default 'open' check (status in ('open','reviewed')),
  created_at timestamptz not null default now(),
  primary key (outing_id,profile_id)
);
create index hosted_outing_reports_user_idx on public.hosted_outing_reports(user_id);
create index hosted_outing_reports_profile_idx on public.hosted_outing_reports(profile_id);

create table public.hosted_outing_feedback (
  outing_id uuid not null references public.hosted_outings(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (outing_id,profile_id)
);
create index hosted_outing_feedback_user_idx on public.hosted_outing_feedback(user_id);
create index hosted_outing_feedback_profile_idx on public.hosted_outing_feedback(profile_id);

alter table public.hosted_outings enable row level security;
alter table public.hosted_outing_attendees enable row level security;
alter table public.hosted_outing_reports enable row level security;
alter table public.hosted_outing_feedback enable row level security;
revoke all on public.hosted_outings,public.hosted_outing_attendees,public.hosted_outing_reports,public.hosted_outing_feedback from public,anon,authenticated;
grant select,insert,update,delete on public.hosted_outings,public.hosted_outing_attendees,public.hosted_outing_reports,public.hosted_outing_feedback to service_role;

create function public.hosted_outing_moderator_eligible(p_staff uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.private_social_staff_roles s
    join public.profiles p on p.id=s.profile_id and p.tombstoned_at is null
    join public.private_social_accounts a on a.profile_id=p.id and a.ownership_state='active'
    join auth.users u on u.id=a.supabase_user_id and (u.banned_until is null or u.banned_until<=now())
    where s.id=p_staff and s.role='moderator' and s.active and s.revoked_at is null
  )
$$;

create function public.hosted_outing_operator_eligible(p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.private_social_staff_roles s
    join public.profiles p on p.id=s.profile_id and p.tombstoned_at is null
    join public.private_social_accounts a on a.profile_id=p.id and a.ownership_state='active'
    join auth.users u on u.id=a.supabase_user_id and (u.banned_until is null or u.banned_until<=now())
    where s.profile_id=p_profile and s.active and s.revoked_at is null
  )
$$;

create function public.create_hosted_outing(p_actor uuid,p_title text,p_venue_id text,p_venue_name text,p_starts_at timestamptz,p_capacity integer,p_moderator uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_profile uuid; v_id uuid;
begin
  select profile_id into v_profile from public.private_social_accounts where id=p_actor and ownership_state='active';
  if v_profile is null or not exists(select 1 from public.private_social_staff_roles where profile_id=v_profile and active and revoked_at is null) then raise exception 'HOSTED_FORBIDDEN'; end if;
  if not public.hosted_outing_moderator_eligible(p_moderator) then raise exception 'HOSTED_MODERATOR_REQUIRED'; end if;
  if p_starts_at <= now() then raise exception 'HOSTED_INVALID'; end if;
  insert into public.hosted_outings(title,venue_id,venue_name,starts_at,capacity,operator_profile_id,moderator_staff_id)
    values(p_title,p_venue_id,p_venue_name,p_starts_at,p_capacity,v_profile,p_moderator) returning id into v_id;
  return v_id;
end $$;

create function public.read_hosted_outings(p_actor uuid,p_outing uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_profile uuid; v_staff boolean; v_result jsonb;
begin
  select profile_id into v_profile from public.private_social_accounts where id=p_actor and ownership_state='active';
  if v_profile is null then raise exception 'HOSTED_FORBIDDEN'; end if;
  select exists(select 1 from public.private_social_staff_roles where profile_id=v_profile and active and revoked_at is null) into v_staff;
  select coalesce(jsonb_agg(item order by starts_at,id),'[]'::jsonb) into v_result from (
    select e.starts_at,e.id,jsonb_build_object(
      'id',e.id,'title',e.title,'venueId',e.venue_id,'venueName',e.venue_name,
      'startsAt',e.starts_at,'capacity',e.capacity,'status',e.status,'revision',e.revision,
      'venueConfirmed',e.venue_confirmation is not null,'enrollmentEnabled',e.enrollment_enabled,
      'signupAllowed',e.enrollment_enabled and e.status='open' and e.starts_at>now() and e.venue_confirmation is not null
        and public.hosted_outing_operator_eligible(e.operator_profile_id) and public.hosted_outing_moderator_eligible(m.id)
        and not exists(select 1 from public.hosted_outing_attendees a where a.outing_id=e.id and a.profile_id=v_profile and a.state in ('waiting','approved','confirmed'))
        and (select count(*) from public.hosted_outing_attendees a where a.outing_id=e.id and a.state<>'cancelled')<200
        and not exists(select 1 from public.social_blocks b where (b.blocker_profile_id=v_profile and b.blocked_profile_id in (e.operator_profile_id,m.profile_id)) or (b.blocked_profile_id=v_profile and b.blocker_profile_id in (e.operator_profile_id,m.profile_id))),
      'confirmationAllowed',e.enrollment_enabled and e.status='open' and e.starts_at>now() and e.venue_confirmation is not null
        and public.hosted_outing_moderator_eligible(m.id)
        and exists(select 1 from public.hosted_outing_attendees a where a.outing_id=e.id and a.profile_id=v_profile and a.state in ('approved','confirmed'))
        and not exists(select 1 from public.social_blocks b where (b.blocker_profile_id=v_profile and b.blocked_profile_id in (e.operator_profile_id,m.profile_id)) or (b.blocked_profile_id=v_profile and b.blocker_profile_id in (e.operator_profile_id,m.profile_id)))
        and not exists(select 1 from public.social_blocks b join public.hosted_outing_attendees a on a.outing_id=e.id and a.state in ('approved','confirmed') and a.profile_id<>v_profile where (b.blocker_profile_id=v_profile and b.blocked_profile_id=a.profile_id) or (b.blocked_profile_id=v_profile and b.blocker_profile_id=a.profile_id)),

      'moderatorActive',coalesce(public.hosted_outing_moderator_eligible(m.id),false),
      'moderatorName',case when public.hosted_outing_moderator_eligible(m.id) then m.display_name else null end,
      'announcement',case when (v_staff and e.operator_profile_id=v_profile) or (m.profile_id=v_profile and public.hosted_outing_moderator_eligible(m.id)) or exists(select 1 from public.hosted_outing_attendees a where a.outing_id=e.id and a.profile_id=v_profile and a.state in ('approved','confirmed')) then e.announcement else '' end,'groupExplanation',case when v_staff and e.operator_profile_id=v_profile or exists(select 1 from public.hosted_outing_attendees a where a.outing_id=e.id and a.profile_id=v_profile and a.state in ('approved','confirmed')) then e.group_explanation else null end,
      'groupBudgetPence',case when exists(select 1 from public.hosted_outing_attendees a where a.outing_id=e.id and a.profile_id=v_profile and a.state in ('approved','confirmed')) then e.group_budget_pence else null end,
      'operator',v_staff and e.operator_profile_id=v_profile,
      'moderator',coalesce(m.profile_id=v_profile and public.hosted_outing_moderator_eligible(m.id),false),
      'attendance',(select jsonb_build_object('state',a.state,'pace',a.pace,'budgetPence',a.budget_pence) from public.hosted_outing_attendees a where a.outing_id=e.id and a.profile_id=v_profile),
      'candidates',case when p_outing is not null and v_staff and e.operator_profile_id=v_profile then
        (select coalesce(jsonb_agg(jsonb_build_object('profileId',a.profile_id,'handle',(select handle from public.profiles where id=a.profile_id),'joinedAt',a.joined_at,'pace',a.pace,'budgetPence',a.budget_pence,'state',a.state) order by a.joined_at,a.profile_id),'[]'::jsonb) from public.hosted_outing_attendees a where a.outing_id=e.id and a.state in ('waiting','approved','confirmed') and not exists(select 1 from public.social_blocks b where (b.blocker_profile_id=a.profile_id and b.blocked_profile_id in (e.operator_profile_id,m.profile_id)) or (b.blocked_profile_id=a.profile_id and b.blocker_profile_id in (e.operator_profile_id,m.profile_id)))) else '[]'::jsonb end,
      'blockedPairs',case when p_outing is not null and v_staff and e.operator_profile_id=v_profile then
        (select coalesce(jsonb_agg(jsonb_build_array(b.blocker_profile_id,b.blocked_profile_id)),'[]'::jsonb) from public.social_blocks b where exists(select 1 from public.hosted_outing_attendees a where a.outing_id=e.id and a.profile_id=b.blocker_profile_id) and exists(select 1 from public.hosted_outing_attendees a where a.outing_id=e.id and a.profile_id=b.blocked_profile_id)) else '[]'::jsonb end,
      'reports',case when p_outing is not null and m.profile_id=v_profile and public.hosted_outing_moderator_eligible(m.id) then
        (select coalesce(jsonb_agg(jsonb_build_object('profileId',r.profile_id,'body',r.body,'status',r.status,'createdAt',r.created_at)),'[]'::jsonb) from public.hosted_outing_reports r where r.outing_id=e.id) else '[]'::jsonb end,
      'ownReport',(select jsonb_build_object('body',r.body,'status',r.status) from public.hosted_outing_reports r where r.outing_id=e.id and r.profile_id=v_profile),
      'feedbackSummary',case when v_staff and e.operator_profile_id=v_profile then (select jsonb_build_object('count',count(*),'average',round(avg(rating),1)) from public.hosted_outing_feedback where outing_id=e.id) else null end,
      'feedback',(select f.rating from public.hosted_outing_feedback f where f.outing_id=e.id and f.profile_id=v_profile),
      'group',case when p_outing is not null and exists(select 1 from public.hosted_outing_attendees a where a.outing_id=e.id and a.profile_id=v_profile and a.state='confirmed') then
        (select coalesce(jsonb_agg(jsonb_build_object('handle',p.handle) order by p.handle),'[]'::jsonb) from public.hosted_outing_attendees a join public.profiles p on p.id=a.profile_id where a.outing_id=e.id and a.state='confirmed' and a.profile_id<>v_profile and not exists(select 1 from public.social_blocks b where (b.blocker_profile_id=v_profile and b.blocked_profile_id=a.profile_id) or (b.blocked_profile_id=v_profile and b.blocker_profile_id=a.profile_id))) else '[]'::jsonb end
    ) item from public.hosted_outings e left join public.private_social_staff_roles m on m.id=e.moderator_staff_id
    where (p_outing is null or e.id=p_outing) and (p_outing is not null or e.starts_at>now()-interval '8 hours' or e.operator_profile_id=v_profile or m.profile_id=v_profile or exists(select 1 from public.hosted_outing_attendees a where a.outing_id=e.id and a.profile_id=v_profile)) and (
      (e.status<>'draft' and e.venue_confirmation is not null) or (v_staff and e.operator_profile_id=v_profile) or (m.profile_id=v_profile and public.hosted_outing_moderator_eligible(m.id)))
    order by e.starts_at,e.id limit 100
  ) items;
  return jsonb_build_object('outings',v_result,'staff',v_staff,'moderationOwners',case when v_staff then (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',display_name) order by display_name),'[]'::jsonb) from public.private_social_staff_roles where public.hosted_outing_moderator_eligible(id)) else '[]'::jsonb end);
end $$;

create function public.change_hosted_outing(p_actor uuid,p_outing uuid,p_action text,p_input jsonb,p_revision integer,p_enrollment_allowed boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.hosted_outings; v_profile uuid; v_user uuid; v_operator boolean; v_moderator boolean; v_state text; v_count integer; v_ids uuid[];
begin
  select profile_id,supabase_user_id into v_profile,v_user from public.private_social_accounts where id=p_actor and ownership_state='active';
  if v_profile is null or v_user is null then raise exception 'HOSTED_FORBIDDEN'; end if;
  select * into e from public.hosted_outings where id=p_outing for update;
  if not found then raise exception 'HOSTED_NOT_FOUND'; end if;
  select exists(select 1 from public.private_social_staff_roles where profile_id=v_profile and active and revoked_at is null) and e.operator_profile_id=v_profile into v_operator;
  select exists(select 1 from public.private_social_staff_roles where id=e.moderator_staff_id and profile_id=v_profile and public.hosted_outing_moderator_eligible(id)) into v_moderator;
  if e.status='draft' and not v_operator and not v_moderator then raise exception 'HOSTED_NOT_FOUND'; end if;
  select state into v_state from public.hosted_outing_attendees where outing_id=e.id and profile_id=v_profile;
  if p_action in ('publish','cancel_outing','complete','announce','approve','remove') and not v_operator then raise exception 'HOSTED_FORBIDDEN'; end if;
  if p_action='review_report' and not v_moderator then raise exception 'HOSTED_FORBIDDEN'; end if;
  if p_action in ('publish','cancel_outing','complete','announce','approve','remove','review_report') and p_revision is distinct from e.revision then raise exception 'HOSTED_STALE'; end if;
  if p_action in ('join','confirm') and exists(select 1 from public.social_blocks b where (b.blocker_profile_id=v_profile and (b.blocked_profile_id=e.operator_profile_id or b.blocked_profile_id=(select profile_id from public.private_social_staff_roles where id=e.moderator_staff_id))) or (b.blocked_profile_id=v_profile and (b.blocker_profile_id=e.operator_profile_id or b.blocker_profile_id=(select profile_id from public.private_social_staff_roles where id=e.moderator_staff_id)))) then raise exception 'HOSTED_BLOCKED'; end if;

  if p_action='publish' then
    if e.status not in ('draft','open') or e.starts_at<=now() or char_length(coalesce(p_input->>'confirmation','')) not between 1 and 500 then raise exception 'HOSTED_INVALID'; end if;
    if not public.hosted_outing_moderator_eligible(e.moderator_staff_id) then raise exception 'HOSTED_MODERATOR_REQUIRED'; end if;
    update public.hosted_outings set status='open',venue_confirmation=p_input->>'confirmation',enrollment_enabled=p_enrollment_allowed where id=e.id;
  elsif p_action='join' then
    if not public.hosted_outing_operator_eligible(e.operator_profile_id) then raise exception 'HOSTED_OPERATOR_REQUIRED'; end if;
    if not p_enrollment_allowed or not e.enrollment_enabled or e.status<>'open' or e.starts_at<=now() or e.venue_confirmation is null then raise exception 'HOSTED_CLOSED'; end if;
    if not public.hosted_outing_moderator_eligible(e.moderator_staff_id) then raise exception 'HOSTED_MODERATOR_REQUIRED'; end if;
    if v_state in ('waiting','approved','confirmed') then return public.read_hosted_outings(p_actor,e.id); end if;
    select count(*) into v_count from public.hosted_outing_attendees where outing_id=e.id and state<>'cancelled';
    if v_count>=200 then raise exception 'HOSTED_FULL'; end if;
    insert into public.hosted_outing_attendees(outing_id,profile_id,user_id,pace,budget_pence)
      values(e.id,v_profile,v_user,p_input->>'pace',(p_input->>'budgetPence')::integer)
      on conflict(outing_id,profile_id) do update set state='waiting',pace=excluded.pace,budget_pence=excluded.budget_pence,joined_at=now(),updated_at=now();
  elsif p_action='cancel' then
    if e.status='completed' then raise exception 'HOSTED_CLOSED'; end if;
    if v_state is null then raise exception 'HOSTED_NOT_FOUND'; end if;
    update public.hosted_outing_attendees set state='cancelled',updated_at=now() where outing_id=e.id and profile_id=v_profile;
  elsif p_action='approve' then
    if not public.hosted_outing_operator_eligible(e.operator_profile_id) then raise exception 'HOSTED_OPERATOR_REQUIRED'; end if;
    if e.status<>'open' or e.starts_at<=now() then raise exception 'HOSTED_CLOSED'; end if;
    select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(p_input->'profileIds');
    if coalesce(cardinality(v_ids),0) not between 2 and e.capacity or (select count(distinct x) from unnest(v_ids) x)<>cardinality(v_ids) then raise exception 'HOSTED_INVALID'; end if;
    if (select count(*) from public.hosted_outing_attendees where outing_id=e.id and profile_id=any(v_ids) and state in ('waiting','approved','confirmed'))<>cardinality(v_ids) then raise exception 'HOSTED_STALE'; end if;
    if exists(select 1 from public.hosted_outing_attendees where outing_id=e.id and state in ('approved','confirmed') and not(profile_id=any(v_ids))) then raise exception 'HOSTED_STALE'; end if;
    if (select count(distinct pace) from public.hosted_outing_attendees where outing_id=e.id and profile_id=any(v_ids))<>1 then raise exception 'HOSTED_INVALID'; end if;
    if exists(select 1 from public.social_blocks where blocker_profile_id=any(v_ids) and blocked_profile_id=any(v_ids)) then raise exception 'HOSTED_BLOCKED'; end if;
    if exists(select 1 from public.social_blocks b where (b.blocker_profile_id=any(v_ids) and (b.blocked_profile_id=e.operator_profile_id or b.blocked_profile_id=(select profile_id from public.private_social_staff_roles where id=e.moderator_staff_id))) or (b.blocked_profile_id=any(v_ids) and (b.blocker_profile_id=e.operator_profile_id or b.blocker_profile_id=(select profile_id from public.private_social_staff_roles where id=e.moderator_staff_id)))) then raise exception 'HOSTED_BLOCKED'; end if;
    if not public.hosted_outing_moderator_eligible(e.moderator_staff_id) then raise exception 'HOSTED_MODERATOR_REQUIRED'; end if;
    update public.hosted_outings set group_explanation=p_input->>'explanation',group_budget_pence=(select min(budget_pence) from public.hosted_outing_attendees where outing_id=e.id and profile_id=any(v_ids)) where id=e.id;
    update public.hosted_outing_attendees set state=case when state='confirmed' then state else 'approved' end,updated_at=now() where outing_id=e.id and profile_id=any(v_ids);
  elsif p_action='confirm' then
    if not p_enrollment_allowed or not e.enrollment_enabled or e.venue_confirmation is null then raise exception 'HOSTED_CLOSED'; end if;
    if e.status<>'open' or e.starts_at<=now() then raise exception 'HOSTED_CLOSED'; end if;
    if v_state not in ('approved','confirmed') or v_state is null then raise exception 'HOSTED_FORBIDDEN'; end if;
    if exists(select 1 from public.social_blocks b join public.hosted_outing_attendees a on a.outing_id=e.id and a.state in ('approved','confirmed') and a.profile_id<>v_profile where (b.blocker_profile_id=v_profile and b.blocked_profile_id=a.profile_id) or (b.blocked_profile_id=v_profile and b.blocker_profile_id=a.profile_id)) then raise exception 'HOSTED_BLOCKED'; end if;
    if not public.hosted_outing_moderator_eligible(e.moderator_staff_id) then raise exception 'HOSTED_MODERATOR_REQUIRED'; end if;
    update public.hosted_outing_attendees set state='confirmed',updated_at=now() where outing_id=e.id and profile_id=v_profile;
  elsif p_action='remove' then
    if e.status<>'open' then raise exception 'HOSTED_CLOSED'; end if;
    update public.hosted_outing_attendees set state='cancelled',updated_at=now() where outing_id=e.id and profile_id=(p_input->>'profileId')::uuid;
  elsif p_action='cancel_outing' then
    if e.status='cancelled' then return public.read_hosted_outings(p_actor,e.id); end if;
    if e.status='completed' then raise exception 'HOSTED_CLOSED'; end if;
    update public.hosted_outings set status='cancelled',enrollment_enabled=false where id=e.id;
    update public.hosted_outing_attendees set state='cancelled',updated_at=now() where outing_id=e.id;
  elsif p_action='complete' then
    if e.status<>'open' or e.starts_at>now() then raise exception 'HOSTED_INVALID'; end if;
    update public.hosted_outings set status='completed',enrollment_enabled=false where id=e.id;
  elsif p_action='announce' then
    update public.hosted_outings set announcement=p_input->>'body' where id=e.id;
  elsif p_action='report' then
    if v_state is null then raise exception 'HOSTED_NOT_FOUND'; end if;
    insert into public.hosted_outing_reports(outing_id,profile_id,user_id,body) values(e.id,v_profile,v_user,p_input->>'body')
      on conflict(outing_id,profile_id) do update set body=excluded.body,status='open',created_at=now();
  elsif p_action='review_report' then
    update public.hosted_outing_reports set status='reviewed' where outing_id=e.id and profile_id=(p_input->>'profileId')::uuid;
  elsif p_action='feedback' then
    if e.status<>'completed' or v_state<>'confirmed' or v_state is null then raise exception 'HOSTED_FORBIDDEN'; end if;
    insert into public.hosted_outing_feedback(outing_id,profile_id,user_id,rating) values(e.id,v_profile,v_user,(p_input->>'rating')::integer)
      on conflict(outing_id,profile_id) do update set rating=excluded.rating;
  else raise exception 'HOSTED_INVALID';
  end if;
  update public.hosted_outings set revision=revision+1 where id=e.id;
  return public.read_hosted_outings(p_actor,e.id);
end $$;

revoke all on function public.hosted_outing_operator_eligible(uuid),public.hosted_outing_moderator_eligible(uuid),public.create_hosted_outing(uuid,text,text,text,timestamptz,integer,uuid),public.read_hosted_outings(uuid,uuid),public.change_hosted_outing(uuid,uuid,text,jsonb,integer,boolean) from public,anon,authenticated;
grant execute on function public.hosted_outing_operator_eligible(uuid),public.hosted_outing_moderator_eligible(uuid),public.create_hosted_outing(uuid,text,text,text,timestamptz,integer,uuid),public.read_hosted_outings(uuid,uuid),public.change_hosted_outing(uuid,uuid,text,jsonb,integer,boolean) to service_role;
commit;
