-- A new report after a moderator decision is new review evidence.
-- Re-open the row in the moderator lane without changing the verified-only
-- automatic-hide counter introduced by migration 0112.

create or replace function public.report_pint_drop_v2(
  p_id uuid,
  p_actor_hash text,
  p_reason text,
  p_hide_threshold int
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted boolean;
  v_count int;
begin
  if not exists (select 1 from public.visit_reports where id = p_id) then
    return null;
  end if;

  insert into public.pint_drop_verified_reports (pint_drop_id, actor_hash, reason)
  values (p_id, p_actor_hash, nullif(p_reason, ''))
  on conflict (pint_drop_id, actor_hash) do nothing;
  v_inserted := found;

  if not v_inserted then
    select verified_report_count into v_count
      from public.visit_reports
     where id = p_id;
    return v_count;
  end if;

  update public.visit_reports
     set verified_report_count = verified_report_count + 1,
         reported_at = now(),
         report_reason = coalesce(nullif(p_reason, ''), report_reason),
         moderated_at = case
                           when moderated_at is not null then null
                           else moderated_at
                         end,
         moderator_note = case
                            when moderated_at is not null then null
                            else moderator_note
                          end,
         status = case
                    when verified_report_count + 1 >= greatest(p_hide_threshold, 1)
                      then 'hidden'
                    when moderated_at is not null
                      then 'visible'
                    else status
                  end
   where id = p_id
   returning verified_report_count into v_count;

  return v_count;
end;
$$;

revoke all on function public.report_pint_drop_v2(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.report_pint_drop_v2(uuid, text, text, int) to service_role;

-- Anonymous reports are review evidence, not an automatic hide counter. Keep
-- threshold-hidden rows hidden until a moderator decision. A row reopens only
-- when moderated_at proves that a moderator has acted on the previous queue
-- entry. The report ledger insert and state update remain one transaction.
create or replace function public.report_pint_drop_anonymous(
  p_id uuid,
  p_actor_hash text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted boolean;
begin
  if not exists (select 1 from public.visit_reports where id = p_id) then
    return false;
  end if;

  insert into public.pint_drop_reports (pint_drop_id, actor_hash, reason)
  values (p_id, p_actor_hash, nullif(p_reason, ''))
  on conflict (pint_drop_id, actor_hash) do nothing;
  v_inserted := found;

  if not v_inserted then
    return true;
  end if;

  update public.visit_reports
     set reported_at = now(),
         report_reason = coalesce(nullif(p_reason, ''), report_reason),
         moderated_at = case
                           when moderated_at is not null then null
                           else moderated_at
                         end,
         moderator_note = case
                            when moderated_at is not null then null
                            else moderator_note
                          end,
         status = case
                   when moderated_at is not null then 'visible'
                   else status
                 end
   where id = p_id;

  return true;
end;
$$;

revoke all on function public.report_pint_drop_anonymous(uuid, text, text) from public, anon, authenticated;
grant execute on function public.report_pint_drop_anonymous(uuid, text, text) to service_role;
