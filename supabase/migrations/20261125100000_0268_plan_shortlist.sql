create table public.plan_shortlists (
  plan_id uuid primary key references public.plans(id) on delete cascade,
  organiser_id uuid not null,
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 1 and 3),
  expires_at timestamptz not null,
  votes jsonb not null default '{}'::jsonb check (jsonb_typeof(votes) = 'object'),
  confirmed jsonb
);

alter table public.plan_shortlists enable row level security;
revoke all on public.plan_shortlists from public, anon, authenticated;
grant select, insert, update on public.plan_shortlists to service_role;

create function public.create_plan_shortlist_atomic(
  p_id uuid, p_title text, p_start_time timestamptz, p_member_id uuid,
  p_member_name text, p_token_hash text, p_joined_at timestamptz,
  p_idempotency_key_hash text, p_request_hash text, p_options jsonb, p_context jsonb
) returns text
language plpgsql security invoker set search_path = public
as $$
declare
  result text;
begin
  result := public.create_plan_with_context_idempotent_atomic(
    p_id, p_title, p_start_time, '[]'::jsonb, p_member_id,
    p_member_name, p_token_hash, p_joined_at, p_idempotency_key_hash, p_request_hash,
    null, null, null, p_context
  );
  if result = 'created' then
    insert into public.plan_shortlists (plan_id, organiser_id, options, expires_at)
    values (p_id, p_member_id, p_options, p_joined_at + interval '168 hours');
  end if;
  return result;
end;
$$;

create function public.mutate_plan_shortlist_atomic(
  p_plan_id uuid, p_invite_token text, p_voter_hash text, p_host_id uuid,
  p_venue_id text, p_start_time timestamptz, p_confirmed_expires_at timestamptz
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  current_plan public.plans%rowtype;
  shortlist public.plan_shortlists%rowtype;
  option_row jsonb;
begin
  select * into current_plan from public.plans where id = p_plan_id
    and social_owner_account_id is null for update;
  if not found then return jsonb_build_object('status', 'missing'); end if;

  if p_host_id is not null then
    if p_host_id is distinct from (
      select id from public.plan_crew_members
      where plan_id = p_plan_id and membership_revoked_at is null
      order by joined_at, id limit 1
    ) then
      return jsonb_build_object('status', 'forbidden');
    end if;
  elsif current_plan.invite_token is distinct from p_invite_token or p_voter_hash is null then
    return jsonb_build_object('status', 'missing');
  end if;

  select * into shortlist from public.plan_shortlists where plan_id = p_plan_id for update;
  if not found then return jsonb_build_object('status', 'missing'); end if;
  if p_host_id is not null and shortlist.organiser_id <> p_host_id then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if shortlist.expires_at <= clock_timestamp() then return jsonb_build_object('status', 'expired'); end if;

  if shortlist.confirmed is not null then
    if p_host_id is not null and shortlist.confirmed->>'venueId' = p_venue_id
      and (shortlist.confirmed->>'startTime')::timestamptz = p_start_time then
      return jsonb_build_object('status', 'unchanged', 'shortlist', to_jsonb(shortlist));
    end if;
    return jsonb_build_object('status', 'closed');
  end if;

  select value into option_row from jsonb_array_elements(shortlist.options)
    where value->>'venueId' = p_venue_id;
  if not found then return jsonb_build_object('status', 'invalid'); end if;

  if p_host_id is not null then
    if p_start_time is null or p_start_time <= clock_timestamp()
      or p_confirmed_expires_at is null or p_confirmed_expires_at <= p_start_time then
      return jsonb_build_object('status', 'invalid');
    end if;
    delete from public.plan_stops where plan_id = p_plan_id;
    insert into public.plan_stops (plan_id, venue_id, venue_name, position)
    values (p_plan_id, p_venue_id, option_row->>'venueName', 0);
    update public.plans set start_time = p_start_time, route_revision = route_revision + 1
    where id = p_plan_id;
    update public.plan_shortlists set
      confirmed = jsonb_build_object('venueId', p_venue_id, 'startTime', p_start_time),
      expires_at = p_confirmed_expires_at
    where plan_id = p_plan_id returning * into shortlist;
  else
    if shortlist.votes->>p_voter_hash = p_venue_id then
      return jsonb_build_object('status', 'unchanged', 'shortlist', to_jsonb(shortlist));
    end if;
    if not shortlist.votes ? p_voter_hash
      and (select count(*) from jsonb_object_keys(shortlist.votes)) >= 200 then
      return jsonb_build_object('status', 'full');
    end if;
    update public.plan_shortlists set votes = votes || jsonb_build_object(p_voter_hash, p_venue_id)
    where plan_id = p_plan_id returning * into shortlist;
  end if;
  return jsonb_build_object('status', 'saved', 'shortlist', to_jsonb(shortlist));
end;
$$;

revoke all on function public.create_plan_shortlist_atomic(uuid,text,timestamptz,uuid,text,text,timestamptz,text,text,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.mutate_plan_shortlist_atomic(uuid,text,text,uuid,text,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.create_plan_shortlist_atomic(uuid,text,timestamptz,uuid,text,text,timestamptz,text,text,jsonb,jsonb) to service_role;
grant execute on function public.mutate_plan_shortlist_atomic(uuid,text,text,uuid,text,timestamptz,timestamptz) to service_role;
