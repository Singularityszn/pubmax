-- Reduced 0068: close Round public reads + explicit client deny.

begin;

drop policy if exists rounds_public_read on public.rounds;
drop policy if exists round_members_public_read on public.round_members;
drop policy if exists round_stops_public_read on public.round_stops;
drop policy if exists round_spends_public_read on public.round_spends;

do $$
declare
  t text;
  tables text[] := array[
    'rounds', 'round_members', 'round_stops', 'round_spends'
  ];
begin
  foreach t in array tables loop
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_client_deny', t);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (false) with check (false)',
      t || '_client_deny',
      t
    );
  end loop;
end $$;

commit;
