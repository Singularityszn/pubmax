create or replace function public.refund_rate_limit_hit(
  p_key text,
  p_expected_hits timestamptz[]
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.rate_limits
     set hits = hits[1:cardinality(hits) - 1]
   where key = p_key
     and hits = p_expected_hits
     and cardinality(hits) > 0;
  return found;
end;
$$;

revoke all on function public.refund_rate_limit_hit(text, timestamptz[])
  from public, anon, authenticated;
grant execute on function public.refund_rate_limit_hit(text, timestamptz[])
  to service_role;
