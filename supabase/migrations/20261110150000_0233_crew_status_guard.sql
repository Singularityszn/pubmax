-- 0233: one guarded writer for a crew member's status.
-- set_crew_status checks the seat, the Plan and the crew before it writes plan_crew_members.status.
-- A legacy Plan seat is found by its token. An open crawl seat is found by its id and its active crew member.
-- An ended seat, a left or removed crew member, or a seat on another Plan answers 'forbidden' or 'not_found'.
-- A completed or abandoned Plan answers 'closed'. lib/planStore.ts and lib/openCrawlArrivalStore.ts call it.
begin;

create function public.set_crew_status(
  p_plan_id uuid,
  p_status text,
  p_token_hash text default null,
  p_seat_id uuid default null,
  p_account_id uuid default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.plans%rowtype;
  v_seat_id uuid;
begin
  if p_status is null or p_status not in ('in', 'on_the_way', 'here', 'running_late', 'start_without_me') then
    return 'invalid';
  end if;
  if (p_token_hash is null) = (p_seat_id is null or p_account_id is null) then return 'invalid'; end if;

  select * into v_plan from public.plans where id = p_plan_id for share;
  if not found then return 'not_found'; end if;

  if p_token_hash is not null then
    if v_plan.social_owner_account_id is not null then return 'not_found'; end if;
    select seat.id into v_seat_id
    from public.plan_crew_members seat
    where seat.plan_id = p_plan_id
      and seat.token_hash = p_token_hash
      and seat.membership_revoked_at is null
    for update;
    if not found then return 'forbidden'; end if;
  else
    select seat.id into v_seat_id
    from public.plan_crew_members seat
    join public.social_crews crew on crew.plan_id = seat.plan_id
    join public.social_crew_members member
      on member.crew_id = crew.id and member.plan_member_id = seat.id
    where seat.plan_id = p_plan_id
      and seat.id = p_seat_id
      and seat.social_account_id = p_account_id
      and seat.membership_revoked_at is null
      and member.social_account_id = p_account_id
      and member.state = 'active'
    for update of seat;
    if not found then return 'not_found'; end if;
  end if;

  if v_plan.status in ('completed', 'abandoned') then return 'closed'; end if;

  update public.plan_crew_members
  set status = p_status, updated_at = statement_timestamp()
  where id = v_seat_id;
  return 'ok';
end;
$$;

revoke all on function public.set_crew_status(uuid, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_crew_status(uuid, text, text, uuid, uuid) to service_role;

commit;
