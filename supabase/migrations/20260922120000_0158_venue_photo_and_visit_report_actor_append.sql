-- 0158: appending a reporter to a venue wall photo, or to a structured visit
-- report, is ONE statement. Captain / firstmate applies. Agents ship SQL only.
--
-- Same defect class as 0105 (profile avatar/cover) and 0116 (profile cover
-- rotation, pint drops): `venuePhotoStore.report` and `visitReportsStore.report`
-- each read `report_actors`, appended the new actor hash in JavaScript, and
-- wrote the whole array back. Two readers flagging the same row within one
-- round trip both read the same base array, both compute [base, self], and the
-- later UPDATE lands last and drops the earlier reporter - `report_count`
-- undercounts and one caller's "recorded" answer is a lie, even though the
-- route told them it worked. `structured_visit_reports`' own 0046 comment
-- called the read-modify-write "acceptable at this scale" before 0105
-- established that two reporters is the scale this product actually sees.
--
-- Postgres appends atomically: the UPDATE's own predicate carries the
-- per-actor uniqueness guard, and the row lock makes a concurrent second
-- reporter re-evaluate that predicate against the just-committed row, so both
-- appends land. Neither table gates the append on a moderation state (a
-- reporter may flag a photo or a report in ANY state), matching the JS this
-- replaces; only whether `moderated_at` resets to reopen the row for review
-- depends on the current state, exactly as the JS conditional did.

create or replace function public.append_venue_photo_report_actor(
  p_id uuid,
  p_actor text,
  p_reason text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  already boolean;
  moved integer := 0;
  stamped_at timestamptz := now();
begin
  if p_id is null then return false; end if;
  if p_actor is null or btrim(p_actor) = '' then return false; end if;

  select coalesce(report_actors, '{}'::text[]) @> array[p_actor]
    into already
    from public.venue_photos
   where id = p_id;
  if already is null then return false; end if;
  if already then return true; end if;

  update public.venue_photos
     set report_actors = array_append(coalesce(report_actors, '{}'::text[]), p_actor),
         report_count = coalesce(cardinality(report_actors), 0) + 1,
         reported_at = stamped_at,
         report_reason = coalesce(nullif(btrim(p_reason), ''), report_reason),
         -- A fresh flag on a currently-approved photo re-opens the reported lane.
         moderated_at = case when moderation_state = 'approved' then null else moderated_at end
   where id = p_id
     and not (coalesce(report_actors, '{}'::text[]) @> array[p_actor]);
  get diagnostics moved = row_count;
  if moved > 0 then return true; end if;

  -- Zero rows means somebody else moved the row between the read and the
  -- write; the actor being present now is still the outcome this call wanted.
  select coalesce(report_actors, '{}'::text[]) @> array[p_actor]
    into already
    from public.venue_photos
   where id = p_id;
  return coalesce(already, false);
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
declare
  already boolean;
  moved integer := 0;
  stamped_at timestamptz := now();
begin
  if p_id is null then return false; end if;
  if p_actor is null or btrim(p_actor) = '' then return false; end if;

  select coalesce(report_actors, '{}'::text[]) @> array[p_actor]
    into already
    from public.structured_visit_reports
   where id = p_id;
  if already is null then return false; end if;
  if already then return true; end if;

  update public.structured_visit_reports
     set report_actors = array_append(coalesce(report_actors, '{}'::text[]), p_actor),
         report_count = coalesce(cardinality(report_actors), 0) + 1,
         reported_at = stamped_at,
         report_reason = coalesce(nullif(btrim(p_reason), ''), report_reason),
         -- A fresh flag on a currently-visible report re-opens the reported lane.
         moderated_at = case when status = 'visible' then null else moderated_at end
   where id = p_id
     and not (coalesce(report_actors, '{}'::text[]) @> array[p_actor]);
  get diagnostics moved = row_count;
  if moved > 0 then return true; end if;

  select coalesce(report_actors, '{}'::text[]) @> array[p_actor]
    into already
    from public.structured_visit_reports
   where id = p_id;
  return coalesce(already, false);
end;
$$;

revoke all on function public.append_visit_report_report_actor(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.append_visit_report_report_actor(uuid, text, text)
  to service_role;
