-- Captain applies. Close updates serialize with inserts, while independent inserts remain compatible.
-- Existing grants, membership checks, rows and receipt columns remain unchanged.
begin;
create function pubmax_private.guard_round_spend_open()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  closed timestamptz;
begin
  -- SHARE conflicts with the NO KEY UPDATE lock taken by closed_at UPDATE.
  select r.closed_at into closed
  from public.rounds r where r.id = new.round_id
  for share;
  -- Preserve the foreign-key refusal for a missing Round.
  if not found then return new; end if;
  if closed is not null then
    -- Refuse a replay here rather than relying on a row that a concurrent
    -- delete could remove before the unique constraint checks it.
    if exists (select 1 from public.round_spends s
               where s.round_id = new.round_id and s.client_ref = new.client_ref) then
      raise exception using errcode = '23505', message = 'round_spend_client_ref_replay';
    end if;
    raise exception using errcode = 'P0204', message = 'round_spend_round_closed';
  end if;
  return new;
end;
$$;
revoke all on function pubmax_private.guard_round_spend_open() from public, anon, authenticated;
grant execute on function pubmax_private.guard_round_spend_open() to service_role;
create trigger round_spends_require_open_round
before insert on public.round_spends
for each row execute function pubmax_private.guard_round_spend_open();
commit;
