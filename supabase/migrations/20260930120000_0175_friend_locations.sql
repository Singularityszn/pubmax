-- 0175: opt-in latest-point sharing. Captain applies; no browser table access.
begin;
-- Non-coordinate authority survives latest-point cleanup and confirmed Stop.
create table public.private_friend_location_generations (
  account_id uuid primary key references public.private_social_accounts(id) on delete cascade,
  generation bigint not null default 0 check(generation between 0 and 9007199254740991)
);
alter table public.private_friend_location_generations enable row level security;
revoke all on public.private_friend_location_generations from public, anon, authenticated;
grant select, insert, update, delete on public.private_friend_location_generations to service_role;
create table public.private_friend_location_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_account_id uuid not null unique references public.private_social_accounts(id) on delete cascade,
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  revision integer not null default 1 check(revision > 0),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  latitude double precision,
  longitude double precision,
  accuracy double precision,
  check(expires_at > started_at and expires_at <= started_at + interval '1 hour'),
  check((latitude is null and longitude is null and accuracy is null) or
    (latitude is not null and longitude is not null and accuracy is not null and latitude between -90 and 90 and longitude between -180 and 180 and accuracy between 0 and 100000)),
  check(revoked_at is null or latitude is null)
);
create table public.private_friend_location_grants (
  session_id uuid not null references public.private_friend_location_sessions(id) on delete cascade,
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  recipient_account_id uuid not null references public.private_social_accounts(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  primary key(session_id, recipient_profile_id)
);
create index private_friend_location_sessions_profile_idx on public.private_friend_location_sessions(owner_profile_id);
create index private_friend_location_sessions_user_idx on public.private_friend_location_sessions(owner_user_id);
create index private_friend_location_grants_profile_idx on public.private_friend_location_grants(recipient_profile_id);
create index private_friend_location_grants_user_idx on public.private_friend_location_grants(recipient_user_id);
create index private_friend_location_grants_recipient_idx on public.private_friend_location_grants(recipient_account_id);
create index private_friend_location_sessions_expiry_idx on public.private_friend_location_sessions(expires_at);
alter table public.private_friend_location_sessions enable row level security;
alter table public.private_friend_location_grants enable row level security;
revoke all on public.private_friend_location_sessions, public.private_friend_location_grants from public, anon, authenticated;
grant select, insert, update, delete on public.private_friend_location_sessions, public.private_friend_location_grants to service_role;

create function public.friend_location_account_live(p_account uuid) returns boolean
language sql stable security definer set search_path=''
as $$
  select exists (
    select 1 from public.private_social_accounts a
    join public.profiles p on p.id=a.profile_id and p.user_id=a.supabase_user_id and p.tombstoned_at is null and char_length(trim(p.handle)) > 0
    join auth.users u on u.id=a.supabase_user_id
    left join public.private_account_identities i on i.user_id=u.id
    where a.id=p_account and a.ownership_state='active'
      and (to_jsonb(u)->>'deleted_at') is null
      and coalesce((to_jsonb(u)->>'banned_until')::timestamptz <= now(),true)
      and case when i.date_of_birth is not null
        then i.date_of_birth <= (current_date - interval '18 years')::date
        else exists(select 1 from public.adult_self_assertions s where s.user_id=u.id and s.asserted_at <= now()) end
  );
$$;
create function public.friend_location_grant_bound() returns trigger
language plpgsql security definer set search_path=''
as $$
begin
  if tg_op='UPDATE' and new.session_id=old.session_id then return new; end if;
  perform 1 from public.private_friend_location_sessions where id=new.session_id for update;
  if (select count(*) from public.private_friend_location_grants where session_id=new.session_id) >= 20 then
    raise exception 'Friend location recipient limit' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger friend_location_grant_bound before insert or update on public.private_friend_location_grants
for each row execute function public.friend_location_grant_bound();

create function public.friend_location_operation(p_actor_account_id uuid, p_operation text, p_input jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_actor public.private_social_accounts%rowtype;
  v_session public.private_friend_location_sessions%rowtype;
  v_recipient public.private_social_accounts%rowtype;
  v_id uuid; v_recipient_id uuid; v_revision integer;
  v_generation bigint; v_expected_generation bigint;
  v_lat double precision; v_lng double precision; v_accuracy double precision;
  v_own jsonb; v_friends jsonb; v_mutuals jsonb;
begin
  if not public.friend_location_account_live(p_actor_account_id) then return jsonb_build_object('ok',false,'code','actor_refused'); end if;
  -- All owner writes share this lock, including replacement starts.
  select * into v_actor from public.private_social_accounts where id=p_actor_account_id for update;
  if not public.friend_location_account_live(p_actor_account_id) then return jsonb_build_object('ok',false,'code','actor_refused'); end if;
  select coalesce((select generation from public.private_friend_location_generations where account_id=v_actor.id),0) into v_generation;
  if p_operation in ('start','reconcile') then
    if jsonb_typeof(p_input->'expectedGeneration') is distinct from 'number'
      or (p_input->>'expectedGeneration')::numeric not between 0 and 9007199254740991
      or trunc((p_input->>'expectedGeneration')::numeric) <> (p_input->>'expectedGeneration')::numeric then
      return jsonb_build_object('ok',false,'code','invalid'); end if;
    v_expected_generation := (p_input->>'expectedGeneration')::bigint;
    if (p_operation='start' and v_expected_generation <> v_generation)
      or v_expected_generation > v_generation then return jsonb_build_object('ok',false,'code','conflict'); end if;
  end if;
  if p_operation in ('read','reconcile') then
    select * into v_session from public.private_friend_location_sessions
      where owner_account_id=v_actor.id and owner_profile_id=v_actor.profile_id and owner_user_id=v_actor.supabase_user_id
        and revoked_at is null and expires_at>now();
  elsif p_operation='start' then
    if jsonb_typeof(p_input->'recipients') is distinct from 'array' then return jsonb_build_object('ok',false,'code','invalid'); end if;
    if jsonb_array_length(p_input->'recipients') not between 1 and 20
      or (select count(distinct value) from jsonb_array_elements_text(p_input->'recipients')) <> jsonb_array_length(p_input->'recipients') then
      return jsonb_build_object('ok',false,'code','invalid'); end if;
    for v_recipient_id in select value::uuid from jsonb_array_elements_text(p_input->'recipients') loop
      select * into v_recipient from public.private_social_accounts where profile_id=v_recipient_id;
      if not found or not public.friend_location_account_live(v_recipient.id)
        or public.social_relationship_between_profiles(v_actor.profile_id,v_recipient_id) <> 'mutual' then
        return jsonb_build_object('ok',false,'code','recipient_refused'); end if;
    end loop;
  elsif p_operation in ('update','revoke') then
    v_id := (p_input->>'sessionId')::uuid; v_revision := (p_input->>'revision')::integer;
    if v_id is null or v_revision is null or v_revision < 1 then return jsonb_build_object('ok',false,'code','invalid'); end if;
    select * into v_session from public.private_friend_location_sessions where id=v_id and owner_account_id=v_actor.id and owner_profile_id=v_actor.profile_id and owner_user_id=v_actor.supabase_user_id for update;
    if not found then return jsonb_build_object('ok',false,'code','conflict'); end if;
    -- A successful retry must fence starts submitted since the previous Stop.
    -- Reuse the ordinary revoke path so each confirmation advances authority.
    if not (p_operation='revoke' and v_session.revoked_at is not null) and
      (v_session.revision <> v_revision or v_session.revoked_at is not null or v_session.expires_at<=now()) then
      return jsonb_build_object('ok',false,'code','conflict'); end if;
  else return jsonb_build_object('ok',false,'code','invalid'); end if;

  if p_operation='reconcile' and v_expected_generation=v_generation then
    if v_generation=9007199254740991 then return jsonb_build_object('ok',false,'code','invalid'); end if;
    v_generation := v_generation+1;
    insert into public.private_friend_location_generations(account_id,generation) values(v_actor.id,v_generation)
      on conflict(account_id) do update set generation=excluded.generation;
  end if;

  if p_operation in ('start','update') then
    v_lat:=(p_input->>'latitude')::double precision;
    v_lng:=(p_input->>'longitude')::double precision;
    v_accuracy:=(p_input->>'accuracy')::double precision;
    if v_lat is null or v_lng is null or v_accuracy is null or not
      (v_lat between -90 and 90 and v_lng between -180 and 180 and v_accuracy between 0 and 100000) then
      return jsonb_build_object('ok',false,'code','invalid'); end if;
    if p_operation='start' then
      if v_generation=9007199254740991 then return jsonb_build_object('ok',false,'code','invalid'); end if;
      v_generation := v_generation+1;
      insert into public.private_friend_location_generations(account_id,generation) values(v_actor.id,v_generation)
        on conflict(account_id) do update set generation=excluded.generation;
      delete from public.private_friend_location_sessions where owner_account_id=v_actor.id;
      insert into public.private_friend_location_sessions(owner_account_id,owner_profile_id,owner_user_id,expires_at,latitude,longitude,accuracy)
      values(v_actor.id,v_actor.profile_id,v_actor.supabase_user_id,now()+interval '1 hour',v_lat,v_lng,v_accuracy) returning * into v_session;
      insert into public.private_friend_location_grants(session_id,recipient_profile_id,recipient_account_id,recipient_user_id)
      select v_session.id,a.profile_id,a.id,a.supabase_user_id from public.private_social_accounts a
        where a.profile_id in (select value::uuid from jsonb_array_elements_text(p_input->'recipients'));
    else
      update public.private_friend_location_sessions set latitude=v_lat,longitude=v_lng,accuracy=v_accuracy,
        updated_at=now(),revision=revision+1 where id=v_session.id returning * into v_session;
    end if;
  elsif p_operation='revoke' then
    if v_generation=9007199254740991 then return jsonb_build_object('ok',false,'code','invalid'); end if;
    v_generation := v_generation+1;
    insert into public.private_friend_location_generations(account_id,generation) values(v_actor.id,v_generation)
      on conflict(account_id) do update set generation=excluded.generation;
    delete from public.private_friend_location_grants where session_id=v_session.id;
    update public.private_friend_location_sessions set revoked_at=coalesce(revoked_at,now()),latitude=null,longitude=null,accuracy=null,
      revision=revision+1 where id=v_session.id;
    return jsonb_build_object('ok',true,'own',null,'generation',v_generation);
  end if;
  if v_session.id is not null then
    select jsonb_build_object('sessionId',v_session.id,'revision',v_session.revision,'expiresAt',v_session.expires_at,'accuracy',v_session.accuracy,
      'recipients',coalesce(jsonb_agg(g.recipient_profile_id) filter(where g.recipient_profile_id is not null),'[]'::jsonb))
      into v_own from public.private_friend_location_grants g where g.session_id=v_session.id;
  end if;
  if p_operation not in ('read','reconcile') then return jsonb_build_object('ok',true,'own',v_own,'generation',v_generation); end if;
  select coalesce(jsonb_agg(jsonb_build_object('profileId',a.profile_id,'handle',p.handle)),'[]'::jsonb) into v_mutuals
    from public.follows outbound
    join public.follows inbound on inbound.follower_id=outbound.followee_id and inbound.followee_id=outbound.follower_id
    join public.private_social_accounts a on a.profile_id=outbound.followee_id
    join public.profiles p on p.id=a.profile_id
    where outbound.follower_id=v_actor.profile_id and a.id<>v_actor.id and public.friend_location_account_live(a.id)
      and public.social_relationship_between_profiles(v_actor.profile_id,a.profile_id)='mutual';
  select coalesce(jsonb_agg(jsonb_build_object('profileId',s.owner_profile_id,'handle',p.handle,
    'latitude',s.latitude,'longitude',s.longitude,'accuracy',s.accuracy,'updatedAt',s.updated_at,'expiresAt',s.expires_at)),'[]'::jsonb)
    into v_friends from public.private_friend_location_sessions s
    join public.private_friend_location_grants g on g.session_id=s.id and g.recipient_account_id=v_actor.id and g.recipient_profile_id=v_actor.profile_id and g.recipient_user_id=v_actor.supabase_user_id
    join public.private_social_accounts owner on owner.id=s.owner_account_id and owner.profile_id=s.owner_profile_id and owner.supabase_user_id=s.owner_user_id
    join public.profiles p on p.id=s.owner_profile_id
    where s.revoked_at is null and s.expires_at>now() and s.updated_at>now()-interval '2 minutes'
      and s.latitude is not null and public.friend_location_account_live(s.owner_account_id)
      and public.social_relationship_between_profiles(s.owner_profile_id,v_actor.profile_id)='mutual';
  return jsonb_build_object('ok',true,'own',v_own,'friends',v_friends,'mutuals',v_mutuals,'generation',v_generation);
exception when invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('ok',false,'code','invalid');
end;
$$;
create function public.purge_friend_locations() returns integer
language plpgsql security definer set search_path=''
as $$ declare v_count integer; begin
  delete from public.private_friend_location_sessions where expires_at<=now() or revoked_at is not null;
  get diagnostics v_count = row_count;
  return v_count;
end; $$;
revoke all on function public.friend_location_account_live(uuid),public.friend_location_grant_bound(),
  public.friend_location_operation(uuid,text,jsonb),public.purge_friend_locations() from public,anon,authenticated;
grant execute on function public.friend_location_operation(uuid,text,jsonb),public.purge_friend_locations() to service_role;
commit;
