begin;

do $$
begin
  if exists (
    select 1
    from public.plan_crew_members
    where crew_committed_at is not null
       or crew_committed_event_id is not null
  ) then
    raise exception 'Refusing to remove recorded Plan crew commitments';
  end if;
end;
$$;

revoke all on function public.join_plan_idempotent_with_crew_commitment_atomic(
  uuid, uuid, text, text, timestamptz, boolean, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.redeem_plan_invite_idempotent_with_crew_commitment_atomic(
  uuid, text, uuid, text, text, timestamptz, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.upsert_plan_invite_rsvp_membership_with_crew_commitment_atomic(
  uuid, text, text, text, uuid, uuid, text, text, text, text, timestamptz, integer
) from public, anon, authenticated, service_role;

drop function if exists public.join_plan_idempotent_with_crew_commitment_atomic(
  uuid, uuid, text, text, timestamptz, boolean, text, text
);
drop function if exists public.redeem_plan_invite_idempotent_with_crew_commitment_atomic(
  uuid, text, uuid, text, text, timestamptz, text, text
);
drop function if exists public.upsert_plan_invite_rsvp_membership_with_crew_commitment_atomic(
  uuid, text, text, text, uuid, uuid, text, text, text, text, timestamptz, integer
);

revoke all on function public.join_plan_idempotent_atomic(
  uuid, uuid, text, text, timestamptz, boolean, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.redeem_plan_invite_idempotent_atomic(
  uuid, text, uuid, text, text, timestamptz, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.upsert_plan_invite_rsvp_membership_atomic(
  uuid, text, text, text, uuid, uuid, text, text, text, text, timestamptz, integer
) from public, anon, authenticated, service_role;

drop function public.join_plan_idempotent_atomic(
  uuid, uuid, text, text, timestamptz, boolean, text, text
);
drop function public.redeem_plan_invite_idempotent_atomic(
  uuid, text, uuid, text, text, timestamptz, text, text
);
drop function public.upsert_plan_invite_rsvp_membership_atomic(
  uuid, text, text, text, uuid, uuid, text, text, text, text, timestamptz, integer
);

alter function public._0125_join_plan_idempotent_atomic(
  uuid, uuid, text, text, timestamptz, boolean, text, text
) rename to join_plan_idempotent_atomic;
alter function public._0125_redeem_plan_invite_idempotent_atomic(
  uuid, text, uuid, text, text, timestamptz, text, text
) rename to redeem_plan_invite_idempotent_atomic;
alter function public._0125_upsert_plan_invite_rsvp_membership_atomic(
  uuid, text, text, text, uuid, uuid, text, text, text, text, timestamptz, integer
) rename to upsert_plan_invite_rsvp_membership_atomic;

revoke all on function public._plan_crew_commitment_for_member(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
drop function if exists public._plan_crew_commitment_for_member(uuid, uuid, boolean);

drop index if exists public.plan_crew_members_crew_commitment_event_idx;
drop index if exists public.plan_crew_members_one_crew_commitment_idx;

alter table public.plan_crew_members
  drop constraint if exists plan_crew_members_commitment_pair_check,
  drop column if exists crew_committed_event_id,
  drop column if exists crew_committed_at;

-- Restore exact 0051 receipt behavior. Every event ID binds to one event name
-- and one token digest before 0125.
create or replace function public.claim_analytics_event_receipt(
  p_event_id uuid,
  p_token_hash text,
  p_event_name text,
  p_now timestamptz,
  p_lease_until timestamptz
) returns text
language plpgsql security invoker set search_path = public
as $$
declare receipt public.analytics_event_receipts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('analytics:event:' || p_event_id::text, 0));
  select * into receipt from public.analytics_event_receipts where event_id = p_event_id for update;
  if found then
    if receipt.token_hash <> p_token_hash or receipt.event_name <> p_event_name then return 'conflict'; end if;
    if receipt.status = 'delivered' then return 'delivered'; end if;
    if receipt.lease_until > p_now then return 'busy'; end if;
    update public.analytics_event_receipts set lease_until = p_lease_until where event_id = p_event_id;
    return 'claimed';
  end if;
  insert into public.analytics_event_receipts (event_id, token_hash, event_name, lease_until, created_at)
  values (p_event_id, p_token_hash, p_event_name, p_lease_until, p_now);
  return 'claimed';
end;
$$;

revoke all on function public.claim_analytics_event_receipt(
  uuid, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_analytics_event_receipt(
  uuid, text, text, timestamptz, timestamptz
) to service_role;

revoke all on function public.join_plan_idempotent_atomic(
  uuid, uuid, text, text, timestamptz, boolean, text, text
) from public, anon, authenticated;
revoke all on function public.redeem_plan_invite_idempotent_atomic(
  uuid, text, uuid, text, text, timestamptz, text, text
) from public, anon, authenticated;
revoke all on function public.upsert_plan_invite_rsvp_membership_atomic(
  uuid, text, text, text, uuid, uuid, text, text, text, text, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.join_plan_idempotent_atomic(
  uuid, uuid, text, text, timestamptz, boolean, text, text
) to service_role;
grant execute on function public.redeem_plan_invite_idempotent_atomic(
  uuid, text, uuid, text, text, timestamptz, text, text
) to service_role;
grant execute on function public.upsert_plan_invite_rsvp_membership_atomic(
  uuid, text, text, text, uuid, uuid, text, text, text, text, timestamptz, integer
) to service_role;

commit;
