-- 0174 is provisional until the integrated migration ledger is reconciled.
-- Captain applies this migration before deploying the reporter RPC callers.
-- Each actor append is one guarded UPDATE under the target row's lock.
-- A duplicate actor keeps every field unchanged. Reporting never hides a row.

begin;

create or replace function public.append_venue_photo_report_actor(
  p_id uuid,
  p_actor text,
  p_reason text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_id is null or p_actor is null or btrim(p_actor) = '' then
    return false;
  end if;

  update public.venue_photos
     set report_actors = array_append(coalesce(report_actors, '{}'::text[]), p_actor),
         report_count = coalesce(cardinality(report_actors), 0) + 1,
         reported_at = now(),
         report_reason = coalesce(nullif(btrim(p_reason), ''), report_reason),
         moderated_at = case when moderation_state = 'approved' then null else moderated_at end
   where id = p_id
     and not (coalesce(report_actors, '{}'::text[]) @> array[p_actor]);
  if found then return true; end if;

  -- Another writer can have appended the same actor while this UPDATE waited.
  -- Its committed append is an acknowledged duplicate, not a missing row.
  return exists (
    select 1 from public.venue_photos
     where id = p_id
       and coalesce(report_actors, '{}'::text[]) @> array[p_actor]
  );
end;
$$;

revoke all on function public.append_venue_photo_report_actor(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.append_venue_photo_report_actor(uuid, text, text)
  to service_role;

create or replace function public.append_visit_report_report_actor(
  p_id uuid,
  p_actor text,
  p_reason text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_id is null or p_actor is null or btrim(p_actor) = '' then
    return false;
  end if;

  update public.structured_visit_reports
     set report_actors = array_append(coalesce(report_actors, '{}'::text[]), p_actor),
         report_count = coalesce(cardinality(report_actors), 0) + 1,
         reported_at = now(),
         report_reason = coalesce(nullif(btrim(p_reason), ''), report_reason),
         moderated_at = case when status = 'visible' then null else moderated_at end
   where id = p_id
     and not (coalesce(report_actors, '{}'::text[]) @> array[p_actor]);
  if found then return true; end if;

  -- Another writer can have appended the same actor while this UPDATE waited.
  -- Its committed append is an acknowledged duplicate, not a missing row.
  return exists (
    select 1 from public.structured_visit_reports
     where id = p_id
       and coalesce(report_actors, '{}'::text[]) @> array[p_actor]
  );
end;
$$;

revoke all on function public.append_visit_report_report_actor(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.append_visit_report_report_actor(uuid, text, text)
  to service_role;

commit;
