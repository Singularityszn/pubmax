-- 0263: The writers 0262 left open are refused once their author's account is being deleted (#3259).
--
-- 1. The deletion trigger already ends these rows. It deletes venue photos, cover
--    photos and poll votes, clears message attachments, ends group seats, and takes the
--    handle off Pint Drops, visit reports and weather picks. A write that landed after
--    the deletion committed escaped each of those rules.
-- 2. Each table gets one BEFORE INSERT trigger that calls 0262's _lock_live_author. A
--    write in flight makes the deletion wait, so the deletion ends its row too. A write
--    that comes second waits for the deletion and is refused with SQLSTATE P0262. A Pint
--    Drop is never deleted: it lands detached, or it is refused.
-- 3. Five tables name their author by handle. _refuse_deleted_handle_write finds the
--    profile that holds the handle now, or held it before (a retired handle is never
--    issued again), and locks that author. A handle that names no profile, such as a
--    guest's name on a Pint Drop, is not refused.
-- 4. No writer of these tables locks a row that the deletion writes before it inserts,
--    and a BEFORE trigger runs before the foreign key checks. So the author lock always
--    comes first, the order 0262 sets. The trigger on messages reads sender_handle, so
--    it does not depend on messages_stamp_sender_profile, which fires after it.
--
-- Needs 0262. Rollback drops the triggers and the handle helper. No data changes.
begin;

do $$
begin
  if pg_catalog.to_regprocedure('public._lock_live_author(uuid)') is null
    or pg_catalog.to_regprocedure('public._refuse_deleted_author_write()') is null then
    raise exception '0263 needs 0262 (public._lock_live_author) applied first';
  end if;
end;
$$;

-- Each trigger argument names a column that holds a handle.
create function public._refuse_deleted_handle_write()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  v_row jsonb := pg_catalog.to_jsonb(new);
  v_column text;
  v_handle text;
  v_profile uuid;
begin
  foreach v_column in array tg_argv loop
    v_handle := pg_catalog.lower(v_row ->> v_column);
    continue when v_handle is null;
    for v_profile in
      select p.id from public.profiles p where pg_catalog.lower(p.handle) = v_handle
      union
      select a.profile_id from public.profile_handle_aliases a where pg_catalog.lower(a.handle) = v_handle
    loop
      perform public._lock_live_author(v_profile);
    end loop;
  end loop;
  return new;
end;
$$;

revoke all on function public._refuse_deleted_handle_write() from public, anon, authenticated, service_role;

create trigger venue_photos_refuse_deleted_author before insert on public.venue_photos
  for each row execute function public._refuse_deleted_author_write('author_profile_id');
create trigger profile_cover_photos_refuse_deleted_author before insert on public.profile_cover_photos
  for each row execute function public._refuse_deleted_author_write('profile_id');
create trigger pint_drops_refuse_deleted_author before insert on public.pint_drops
  for each row execute function public._refuse_deleted_handle_write('handle');
create trigger structured_visit_reports_refuse_deleted_author before insert on public.structured_visit_reports
  for each row execute function public._refuse_deleted_handle_write('handle');
create trigger weather_recommendations_refuse_deleted_author before insert on public.weather_recommendations
  for each row execute function public._refuse_deleted_handle_write('contributor_handle');
create trigger message_poll_votes_refuse_deleted_author before insert on public.message_poll_votes
  for each row execute function public._refuse_deleted_handle_write('voter_handle');
create trigger messages_refuse_deleted_author before insert on public.messages
  for each row execute function public._refuse_deleted_handle_write('sender_handle');
create trigger conversation_members_refuse_deleted_author before insert on public.conversation_members
  for each row execute function public._refuse_deleted_handle_write('handle');

commit;
