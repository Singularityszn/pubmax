begin;

create or replace function pubmax_private.rls_owns_handle(p_handle text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_handle is not null and length(btrim(p_handle)) > 0
    and (select auth.uid()) is not null
    and exists (
      select 1 from public.profiles p
      where p.tombstoned_at is null and p.user_id = (select auth.uid())
        and (lower(p.handle) = lower(btrim(p_handle)) or exists (
          select 1 from public.profile_handle_aliases a
          where a.profile_id = p.id and lower(a.handle) = lower(btrim(p_handle))
        ))
    );
$$;

revoke execute on function pubmax_private.rls_owns_handle(text) from public, anon;
grant execute on function pubmax_private.rls_owns_handle(text) to authenticated, service_role;
commit;
