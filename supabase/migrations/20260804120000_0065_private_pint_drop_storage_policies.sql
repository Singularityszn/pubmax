-- Private Pint Drop photo reads (issue: posting end to end).
--
-- The `pint-drops` bucket is private. The app's service-role server creates
-- short-lived signed URLs only after the Pint Drop read path has applied its
-- moderation and visibility rules. This policy is the Storage-side guard for
-- authenticated direct reads: anonymous clients get no object access, and no
-- anon/authenticated write policy is added. Uploads and deletes stay on the
-- server's service-role path in lib/pintDropsStore.ts.
--
-- Storage object names are the exact keys persisted on visit_reports, so the
-- policy can bind an object to its drop instead of granting every authenticated
-- user the whole bucket. The SECURITY DEFINER helper is required because
-- migration 0023 intentionally denies raw visit_reports reads to authenticated
-- clients. It mirrors the app's public visibility contract:
--   public / anonymous: every signed-in viewer;
--   friends: the author and the author's followers;
--   legacy: the author only;
--   hidden / pending: nobody.

create or replace function public.can_read_pint_drop_photo(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.visit_reports as d
    where d.status = 'visible'
      and (
        d.pint_photo_key = p_object_name
        or d.venue_photo_key = p_object_name
      )
      and (
        d.visibility in ('public', 'anonymous')
        or (
          d.visibility = 'friends'
          and exists (
            select 1
            from public.profiles as viewer
            where viewer.user_id = (select auth.uid())
              and (
                lower(viewer.handle) = lower(d.handle)
                or exists (
                  select 1
                  from public.profile_handle_aliases as viewer_alias
                  where viewer_alias.profile_id = viewer.id
                    and lower(viewer_alias.handle) = lower(d.handle)
                )
                or exists (
                  select 1
                  from public.follows as follow_edge
                  join public.profiles as author
                    on author.id = follow_edge.followee_id
                  where follow_edge.follower_id = viewer.id
                    and (
                      lower(author.handle) = lower(d.handle)
                      or exists (
                        select 1
                        from public.profile_handle_aliases as author_alias
                        where author_alias.profile_id = author.id
                          and lower(author_alias.handle) = lower(d.handle)
                      )
                    )
                )
              )
          )
        )
        or (
          d.visibility = 'legacy'
          and exists (
            select 1
            from public.profiles as viewer
            where viewer.user_id = (select auth.uid())
              and (
                lower(viewer.handle) = lower(d.handle)
                or exists (
                  select 1
                  from public.profile_handle_aliases as viewer_alias
                  where viewer_alias.profile_id = viewer.id
                    and lower(viewer_alias.handle) = lower(d.handle)
                )
              )
          )
        )
      )
  );
$$;

revoke all on function public.can_read_pint_drop_photo(text)
  from public, anon, authenticated;
grant execute on function public.can_read_pint_drop_photo(text)
  to authenticated, service_role;

drop policy if exists pint_drop_photos_authenticated_read on storage.objects;
create policy pint_drop_photos_authenticated_read
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'pint-drops'
    and public.can_read_pint_drop_photo(name)
  );
