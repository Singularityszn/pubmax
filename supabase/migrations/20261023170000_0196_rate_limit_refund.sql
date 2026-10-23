-- Each reservation calls this at most once. Keep refunds in one UPDATE so
-- concurrent cancellations serialize on the bucket without comparison retries.
create or replace function public.refund_rate_limit_hit(p_key text)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.rate_limits
     set hits = hits[1:cardinality(hits) - 1]
   where key = p_key
     and cardinality(hits) > 0;
  -- Empty or expired buckets already have no unused unit to return.
  return true;
end;
$$;

revoke all on function public.refund_rate_limit_hit(text)
  from public, anon, authenticated;
grant execute on function public.refund_rate_limit_hit(text)
  to service_role;
