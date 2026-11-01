-- Optional mystery presentation. No route or arrival state is changed.
begin;
create table public.plan_presentation_settings (
  plan_id uuid primary key references public.plans(id) on delete cascade,
  mystery_enabled boolean not null default false
);
alter table public.plan_presentation_settings enable row level security;
revoke all on public.plan_presentation_settings from public, anon, authenticated;
grant all on public.plan_presentation_settings to service_role;

create function public.plan_presentation(
  p_plan_id uuid,
  p_token_hash text,
  p_mystery_enabled boolean default null,
  p_expected_route_revision integer default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans%rowtype;
  v_member public.plan_crew_members%rowtype;
  v_host uuid;
  v_enabled boolean;
  v_edit boolean;
begin
  if public._social_plan_is_bound(p_plan_id) then return jsonb_build_object('error','forbidden'); end if;
  select * into v_plan from public.plans where id = p_plan_id for update;
  if not found then return jsonb_build_object('error','forbidden'); end if;
  select id into v_host from public.plan_crew_members where plan_id = p_plan_id order by joined_at,id limit 1;
  select * into v_member from public.plan_crew_members where plan_id = p_plan_id and token_hash = p_token_hash and membership_revoked_at is null for share;
  if not found or (v_member.id is distinct from v_host and not coalesce(v_member.can_collaborate,false)) then
    return jsonb_build_object('error','forbidden');
  end if;
  v_edit := v_member.id = v_host and coalesce(v_plan.status,'draft') not in ('completed','abandoned');
  if p_mystery_enabled is not null then
    if not v_edit then return jsonb_build_object('error','forbidden'); end if;
    if p_expected_route_revision is null or p_expected_route_revision < 1 then return jsonb_build_object('error','invalid'); end if;
    if p_expected_route_revision <> v_plan.route_revision then return jsonb_build_object('error','conflict'); end if;
    insert into public.plan_presentation_settings(plan_id,mystery_enabled) values(p_plan_id,p_mystery_enabled)
      on conflict(plan_id) do update set mystery_enabled = excluded.mystery_enabled;
  end if;
  select mystery_enabled into v_enabled from public.plan_presentation_settings where plan_id = p_plan_id;
  return jsonb_build_object('memberId',v_member.id,'canEdit',v_edit,'mysteryEnabled',coalesce(v_enabled,false),'routeRevision',v_plan.route_revision);
end;
$$;
revoke all on function public.plan_presentation(uuid,text,boolean,integer) from public, anon, authenticated;
grant execute on function public.plan_presentation(uuid,text,boolean,integer) to service_role;
commit;
