-- Rollback for 0150. It restores 0145's tombstone trigger and 0079's
-- contributor leaderboard exactly, then drops the ledger and the three stamps.
--
-- WHAT THIS COSTS, said plainly: the ledger is the only record pairing a
-- departed account with what it logged, so dropping the table forgets every
-- departure recorded since 0150 was applied, and dropping the stamps puts the
-- retired handles back on the public lanes. Neither loss touches a
-- contribution: every price, measure and date stays exactly where it is, which
-- is the half of the captain's ruling that needs no migration to hold.
--
-- Run it only to take the forward file back off a cluster it should not be on.

begin;

-- 0145's trigger, restated whole: no ledger insert, no retirement stamps.
create or replace function public.stamp_profile_tombstone_on_auth_user_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.venue_photos vp
   using public.profiles p
   where p.id = vp.author_profile_id
     and p.user_id = old.id;

  delete from public.profile_cover_photos c
   using public.profiles p
   where p.id = c.profile_id
     and p.user_id = old.id;

  update public.messages m
     set body = case when char_length(m.body) >= 1 then m.body else 'Photo removed.' end,
         attachment_kind = null,
         attachment_object_key = null,
         attachment_width = null,
         attachment_height = null,
         attachment_venue_id = null
    from public.profiles p
   where p.handle = m.sender_handle
     and p.user_id = old.id
     and m.attachment_kind is not null;

  update public.private_social_accounts
     set ownership_state = 'suspended',
         ownership_changed_at = now(),
         supabase_user_id = null,
         updated_at = now()
   where supabase_user_id = old.id;

  update public.profiles
     set tombstoned_at = coalesce(tombstoned_at, now()),
         avatar_url = null,
         avatar_object_key = null,
         avatar_generation = null,
         avatar_moderation_state = null,
         avatar_report_count = 0,
         avatar_reported_at = null,
         avatar_report_reason = null,
         avatar_report_actors = '{}'::text[],
         avatar_moderated_at = null,
         avatar_moderator_note = null,
         cover_object_key = null,
         cover_generation = null,
         cover_moderation_state = null,
         cover_report_count = 0,
         cover_reported_at = null,
         cover_report_reason = null,
         cover_report_actors = '{}'::text[],
         cover_moderated_at = null,
         cover_moderator_note = null,
         favourite_drink = null,
         interests = null,
         workplace = null,
         updated_at = now()
   where user_id = old.id;

  return old;
end;
$$;

revoke all on function public.stamp_profile_tombstone_on_auth_user_delete() from public, anon, authenticated;

-- 0079's leaderboard, restated whole: no tombstone predicate.
create or replace function public.public_contributor_leaderboard()
returns table (
  handle text,
  prices bigint,
  reviews bigint,
  recommendations bigint,
  total bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with visible_contributions as (
    select contributor_handle as handle, 'price'::text as lane,
           submitted_at as recorded_at
      from public.community_prices
     where contributor_handle is not null
       and hidden_at is null
    union all
    select handle, 'review'::text as lane,
           created_at as recorded_at
      from public.structured_visit_reports
     where status = 'visible'
    union all
    select contributor_handle as handle, 'recommendation'::text as lane,
           submitted_at as recorded_at
      from public.weather_recommendations
     where status = 'visible'
  ),
  canonical_contributions as (
    select profile.handle,
           contribution.lane
      from visible_contributions as contribution
      join public.profile_handle_aliases as alias
        on lower(alias.handle) = lower(contribution.handle)
       and contribution.recorded_at >= alias.claimed_at
      join public.profiles as profile
        on profile.id = alias.profile_id
  )
  select
    handle,
    count(*) filter (where lane = 'price') as prices,
    count(*) filter (where lane = 'review') as reviews,
    count(*) filter (where lane = 'recommendation') as recommendations,
    count(*) as total
  from canonical_contributions
  group by handle
  order by total desc, handle asc;
$$;

revoke all on function public.public_contributor_leaderboard() from public;
grant execute on function public.public_contributor_leaderboard() to service_role;

alter table public.pint_drops drop column if exists author_retired_at;
alter table public.structured_visit_reports drop column if exists author_retired_at;
alter table public.weather_recommendations drop column if exists author_retired_at;

drop policy if exists account_retention_ledger_client_deny
  on public.account_retention_ledger;

drop table if exists public.account_retention_ledger;

commit;
