-- Rollback 0247: hosts stop marking who came, and moderators stop correcting it.
-- It drops social_crew_attendance, its reports and its functions, deletes every
-- attendance write receipt and drops the receipt columns that named a guest.
--
-- THIS DELETES ATTENDANCE RECORDS. Every host mark and every moderator correction, with
-- its reason, and every guest's report about a mark, open or decided, is gone and
-- cannot be restored. Before anything else the rollback locks
-- the receipts and the table against writers, without waiting, and counts the rows.
-- When either is busy it stops with "could not obtain lock"; run it again. When there
-- are rows, export what must be kept, then set pubmax.crew_attendance_discarded to that
-- exact count and run it again.
begin;

do $$
declare v_rows bigint := 0;
begin
  if to_regclass('public.social_crew_attendance') is not null then
    -- Held until commit, so the count cannot change before the drop. Receipts first:
    -- an attestation reads its receipt before it writes a mark.
    lock table public.private_social_crew_write_receipts in access exclusive mode nowait;
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
drop function if exists public.read_social_crew_attendance_reports_admin(uuid,integer);
drop function if exists public.report_social_crew_attendance(uuid,uuid,uuid,integer);
drop function if exists public.export_social_crew_attendance(uuid,integer);
drop function if exists public.read_social_crew_attendance(uuid,uuid,uuid);
drop function if exists public.correct_social_crew_attendance_admin(uuid,uuid,uuid,text,integer,text);
drop function if exists public.attest_social_crew_attendance_atomic(uuid,uuid,uuid,text,integer,text,text);
drop function if exists public._social_crew_attendance_refuse(boolean,uuid,text,text,text,text,uuid,timestamptz);
drop function if exists public._social_crew_attendance_finish(uuid,text,text,text,jsonb,uuid,timestamptz);
drop function if exists public._social_crew_attendance_markable(uuid,uuid,uuid);
drop function if exists public._social_crew_attendance_moderator_conflicted(uuid,uuid,uuid);
drop function if exists public._social_crew_attendance_current(uuid,uuid);
drop function if exists public._social_crew_attendance_window(uuid);
drop table if exists public.social_crew_attendance_reports;
drop table if exists public.social_crew_attendance;

delete from public.private_social_crew_write_receipts where operation like 'attendance:%';
drop index if exists public.private_social_crew_write_receipts_expires_idx;
drop index if exists public.private_social_crew_write_receipts_subject_idx;
alter table public.private_social_crew_write_receipts
  drop constraint if exists private_social_crew_write_receipts_attendance_subject,
  drop column if exists expires_at,
  drop column if exists subject_user_id;

commit;
