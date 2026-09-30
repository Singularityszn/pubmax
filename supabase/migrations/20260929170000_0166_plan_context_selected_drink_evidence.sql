-- 0166: A context edit invalidates selected drink evidence for a different lane.

create or replace function public.update_legacy_plan_status_context_atomic(
  p_plan_id uuid,p_token_hash text,p_status text,p_context jsonb
) returns text
language plpgsql security definer set search_path=''
as $$
declare v_plan public.plans%rowtype; v_host_token text;
begin
  select * into v_plan from public.plans where id=p_plan_id for update;
  if not found or v_plan.social_owner_account_id is not null then return 'not_found'; end if;

  select token_hash into v_host_token from public.plan_crew_members
    where plan_id=p_plan_id order by joined_at,id limit 1;
  if v_host_token is null or p_token_hash is null or v_host_token <> p_token_hash then return 'forbidden'; end if;

  if p_status is not null and (
    p_status not in ('draft','ready','active','ending','completed','abandoned')
    or not (
      p_status=v_plan.status
      or (v_plan.status='draft' and p_status in ('ready','abandoned'))
      or (v_plan.status='ready' and p_status in ('draft','active','abandoned'))
      or (v_plan.status='active' and p_status in ('ending','completed','abandoned'))
      or (v_plan.status='ending' and p_status in ('active','completed','abandoned'))
    )
  ) then return 'invalid'; end if;

  update public.plans set
    status=coalesce(p_status,status),
    night_context=coalesce(p_context,night_context)
  where id=p_plan_id;

  if p_context is not null then
    update public.plan_stops
    set selected_drink_price_evidence = null
    where plan_id = p_plan_id
      and selected_drink_price_evidence is not null
      and (
        p_context->>'zeroProof' = 'true'
        or selected_drink_price_evidence->>'category' is distinct from p_context->>'drinkCategory'
      );
  end if;
  return 'ok';
end;
$$;
