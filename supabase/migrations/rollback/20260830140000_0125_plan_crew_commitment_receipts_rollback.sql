drop function if exists public.redeem_plan_invite_idempotent_atomic_with_commitment(uuid,text,uuid,text,text,timestamptz,text,text);
drop function if exists public.join_plan_idempotent_atomic_with_commitment(uuid,uuid,text,text,timestamptz,boolean,text,text);
drop function if exists pubmax_private.plan_join_commitment_result(uuid,uuid,text,timestamptz);

drop index if exists public.plan_crew_one_commitment_receipt_idx;

alter table public.plan_crew_members
  drop constraint if exists plan_crew_members_commitment_receipt_pair,
  drop column if exists crew_committed_route_ready,
  drop column if exists crew_committed_at;
