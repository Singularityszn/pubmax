-- Coordinate keyed table requests before recipient resolution.
-- Apply only on the captain's instruction.
begin;

alter table public.table_requests
  add column if not exists revision integer not null default 0;
alter table public.table_requests drop constraint if exists table_requests_revision_check;
alter table public.table_requests add constraint table_requests_revision_check check (revision >= 0);
alter table public.table_requests drop constraint table_requests_delivery_check;
alter table public.table_requests add constraint table_requests_delivery_check
  check (delivery in ('resolving', 'pending', 'emailed', 'not_sent'));

create or replace function public.transition_table_request(
  p_id uuid, p_requester uuid, p_from text, p_revision integer,
  p_to text, p_delivered_at timestamptz default null
) returns setof public.table_requests
language sql security definer set search_path = '' as $$
  update public.table_requests
  set delivery = p_to, revision = revision + 1, delivered_at = p_delivered_at
  where id = p_id and requester_user_id = p_requester
    and delivery = p_from and revision = p_revision
    and ((p_from = 'resolving' and p_to in ('pending', 'not_sent') and p_delivered_at is null)
      or (p_from = 'pending' and p_to = 'emailed' and p_delivered_at is not null))
  returning *;
$$;
revoke all on function public.transition_table_request(uuid, uuid, text, integer, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.transition_table_request(uuid, uuid, text, integer, text, timestamptz)
  to service_role;

commit;
