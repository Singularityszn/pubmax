-- Preserve only the names needed to redact a cleared profile's Story mentions.
-- Captain applies. Rollback removes this material; restore application first.
begin;

create table if not exists public.private_story_redaction_names (
  story_id uuid not null references public.night_stories(id) on delete cascade,
  account_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (btrim(display_name) <> ''),
  primary key (story_id, account_id, display_name)
);
-- The primary key serves Story reads/cascades. Index the other FK so an auth
-- account deletion does not scan every Story's retained names.
create index if not exists private_story_redaction_names_account_idx
  on public.private_story_redaction_names (account_id);
alter table public.private_story_redaction_names enable row level security;
revoke all on table public.private_story_redaction_names from public, anon, authenticated;
grant select, insert, update, delete on table public.private_story_redaction_names to service_role;
drop policy if exists private_story_redaction_names_client_deny on public.private_story_redaction_names;
create policy private_story_redaction_names_client_deny
  on public.private_story_redaction_names for all to anon, authenticated
  using (false) with check (false);

create or replace function public.accept_night_story_contribution_atomic(
  p_actor_id uuid,
  p_story_id uuid,
  p_joined_at timestamptz
)
returns setof public.night_story_contributors
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.profiles where user_id = p_actor_id for update;
  return query update public.night_story_contributors
    set status = 'accepted', joined_at = p_joined_at
    where story_id = p_story_id
      and profile_id = p_actor_id
      and status = 'invited'
    returning *;
end;
$$;
revoke all on function public.accept_night_story_contribution_atomic(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.accept_night_story_contribution_atomic(uuid, uuid, timestamptz)
  to service_role;

create or replace function public.set_night_moment_publication_consent_atomic(
  p_actor_id uuid,
  p_story_id uuid,
  p_moment_id uuid,
  p_status text,
  p_decided_at timestamptz
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if p_status is null or p_status not in ('approved', 'withdrawn') then
    return false;
  end if;

  perform 1 from public.profiles where user_id = p_actor_id for update;
  insert into public.night_moment_consents (story_id, moment_id, owner_id, status, decided_at)
    values (p_story_id, p_moment_id, p_actor_id, p_status, p_decided_at)
    on conflict (story_id, moment_id) do update set
      owner_id = excluded.owner_id,
      status = excluded.status,
      decided_at = excluded.decided_at;

  if p_status = 'withdrawn' then
    delete from public.night_story_moments
     where story_id = p_story_id and moment_id = p_moment_id;
  end if;
  return true;
end;
$$;
revoke all on function public.set_night_moment_publication_consent_atomic(uuid, uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.set_night_moment_publication_consent_atomic(uuid, uuid, uuid, text, timestamptz)
  to service_role;

create or replace function public.clear_profile_for_caller(p_handle text, p_caller_user_id uuid)
returns setof public.profiles
language plpgsql security definer set search_path = ''
as $$
declare
  owned public.profiles%rowtype;
begin
  select p.* into owned from public.profiles p
   where p.handle = p_handle
     and (p.user_id is null or p.user_id = p_caller_user_id)
   for update;
  if not found then return; end if;

  if owned.user_id is not null then
    -- Capture the IDs the withdrawal actually changed. Under READ COMMITTED,
    -- a separate earlier SELECT can miss an invitation accepted between the
    -- capture and withdrawal statements.
    with withdrawn as (
      update public.night_story_contributors set status = 'withdrawn'
       where profile_id = owned.user_id and status = 'accepted'
       returning story_id
    ), withdrawn_consents as (
      -- A consent can survive its contributor relation. Withdraw it before
      -- clearing the only display name, including approved and pending rows.
      update public.night_moment_consents
        set status = 'withdrawn',
            decided_at = case when status = 'withdrawn' then decided_at else now() end
        where owner_id = owned.user_id
        returning story_id
    )
    insert into public.private_story_redaction_names (story_id, account_id, display_name)
    select affected.story_id, owned.user_id, owned.display_name
    from (
      select story_id from withdrawn
      union
      select c.story_id from public.night_story_contributors c
       where c.profile_id = owned.user_id and c.status = 'withdrawn'
      union
      select story_id from withdrawn_consents
    ) affected
    where nullif(btrim(owned.display_name), '') is not null
    on conflict do nothing;

    delete from public.night_story_moments sm
      using public.night_moment_consents c
      where c.owner_id = owned.user_id and c.status = 'withdrawn'
        and sm.story_id = c.story_id and sm.moment_id = c.moment_id;
  end if;

  return query update public.profiles set
    display_name = null, avatar_url = null, home_city = null, bio = null,
    favourite_drink = null, interests = null, workplace = null,
    avatar_object_key = null, avatar_generation = null, avatar_moderation_state = null,
    avatar_report_count = 0, avatar_report_actors = '{}', avatar_reported_at = null,
    avatar_report_reason = null, avatar_moderated_at = null, avatar_moderator_note = null,
    cover_object_key = null, cover_generation = null, cover_moderation_state = null,
    cover_report_count = 0, cover_report_actors = '{}', cover_reported_at = null,
    cover_report_reason = null, cover_moderated_at = null, cover_moderator_note = null,
    updated_at = now()
   where id = owned.id returning *;
end;
$$;
revoke all on function public.clear_profile_for_caller(text, uuid) from public, anon, authenticated;
grant execute on function public.clear_profile_for_caller(text, uuid) to service_role;
commit;
