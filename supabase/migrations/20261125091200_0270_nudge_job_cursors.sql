create table public.nudge_job_cursors (
  job text primary key check (job in ('step-out', 'cheap-pint')),
  cursor text,
  lease uuid,
  lease_until timestamptz
);
alter table public.nudge_job_cursors enable row level security;
revoke all on public.nudge_job_cursors from public, anon, authenticated;
grant select, insert, update on public.nudge_job_cursors to service_role;

create function public.claim_nudge_job(p_job text, p_lease uuid)
returns table (cursor text) language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.nudge_job_cursors (job, lease, lease_until)
    values (p_job, p_lease, now() + interval '70 seconds')
  on conflict (job) do update set lease = excluded.lease, lease_until = excluded.lease_until
    where public.nudge_job_cursors.lease is null or public.nudge_job_cursors.lease_until <= now();
  return query select c.cursor from public.nudge_job_cursors c where c.job = p_job and c.lease = p_lease;
end $$;

create function public.advance_nudge_job(p_job text, p_lease uuid, p_cursor text, p_release boolean)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  update public.nudge_job_cursors set cursor = p_cursor,
    lease = case when p_release then null else lease end,
    lease_until = case when p_release then null else lease_until end
  where job = p_job and lease = p_lease and lease_until > now();
  get diagnostics changed = row_count;
  return changed = 1;
end $$;
revoke all on function public.claim_nudge_job(text,uuid) from public, anon, authenticated;
revoke all on function public.advance_nudge_job(text,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.claim_nudge_job(text,uuid) to service_role;
grant execute on function public.advance_nudge_job(text,uuid,text,boolean) to service_role;
