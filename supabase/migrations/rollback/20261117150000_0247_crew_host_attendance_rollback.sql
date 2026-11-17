-- Rollback 0247: hosts stop marking who came, and moderators stop correcting it.
-- It drops social_crew_attendance and its functions.
--
-- THIS DELETES ATTENDANCE RECORDS. Every host mark and every moderator correction, with
-- its reason, is gone and cannot be restored. Before anything else the rollback locks
-- the table against writers and counts its rows. When there are rows, export what must
-- be kept, then set pubmax.crew_attendance_discarded to that exact count and run it
-- again. The Crew write receipts of past marks stay until their account is deleted.
begin;

do $$
declare v_rows bigint := 0;
begin
  if to_regclass('public.social_crew_attendance') is not null then
    -- Held until commit, so the count cannot change before the drop.
    lock table public.social_crew_attendance in access exclusive mode nowait;
    select count(*) into v_rows from public.social_crew_attendance;
  end if;
  if v_rows > 0
    and coalesce(current_setting('pubmax.crew_attendance_discarded', true), '') <> v_rows::text then
    raise exception 'Rollback 0247 would drop % crew attendance records. Export what must be kept, then set pubmax.crew_attendance_discarded to that count and run it again.', v_rows;
  end if;
end;
$$;

drop function if exists public.purge_expired_social_crew_attendance(integer);
drop function if exists public.export_social_crew_attendance(uuid,integer);
drop function if exists public.read_social_crew_attendance(uuid,uuid,uuid);
drop function if exists public.correct_social_crew_attendance_admin(uuid,uuid,uuid,text,integer,text);
drop function if exists public.attest_social_crew_attendance_atomic(uuid,uuid,uuid,text,integer,text,text);
drop function if exists public._social_crew_attendance_markable(uuid,uuid,uuid);
drop function if exists public._social_crew_attendance_current(uuid,uuid);
drop function if exists public._social_crew_attendance_window(uuid);
drop table if exists public.social_crew_attendance;

commit;
