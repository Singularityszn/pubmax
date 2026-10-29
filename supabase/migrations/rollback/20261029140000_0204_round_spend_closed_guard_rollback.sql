-- Captain applies. Cost: removes atomic close protection and restores the known race.
-- Existing data, permissions and unique constraints remain unchanged.
begin;
drop trigger round_spends_require_open_round on public.round_spends;
drop function pubmax_private.guard_round_spend_open();
commit;
