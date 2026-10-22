-- Captain applies 0184. A live-row CAS can wait on a row lock past its deadline:
-- now() stays at transaction start, so check the wall clock at the row write.
-- Keep INSERT/DELETE recovery, ownership, revision and the stored deadline intact.
begin;

create function pubmax_private.refuse_expired_pub_pal_tool_turn_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.expires_at <= pg_catalog.clock_timestamp() then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function pubmax_private.refuse_expired_pub_pal_tool_turn_update()
  from public, anon, authenticated, service_role;

create trigger pub_pal_tool_turns_refuse_expired_update
before update on public.pub_pal_tool_turns
for each row execute function pubmax_private.refuse_expired_pub_pal_tool_turn_update();

commit;
