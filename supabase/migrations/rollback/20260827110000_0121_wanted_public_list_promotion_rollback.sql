-- Rollback of 0121. This DROPS THE PROMOTION FUNCTION AND THE TWO COLUMNS THAT
-- RECORD A PROMOTION.
--
-- ROLL BACK 0122 FIRST if it is applied. 0122 is a `create or replace` of this
-- same function, so it owns the live body; this file drops the function
-- outright, which removes 0122's body too and leaves 0122's own rollback with
-- nothing to restore. Run 0122's rollback, then this one, or accept that the
-- function is simply gone.
--
-- What is lost is asymmetrical with what is kept. Every saved_pubs row a
-- promotion created SURVIVES, because the promotion inserted it and this drops
-- no saved list. What goes is the Wanted's own record that it was promoted and
-- when, so after this a Wanted that was already turned into a saved pub reads
-- as unpromoted and can be promoted again. The second promotion is harmless at
-- the saved_pubs table, whose (profile_id, venue_id, list_type) uniqueness
-- absorbs it, but a drinker sees the offer to save a pub they already saved.
--
-- The pairing CHECK goes with the columns, so no row is left half-promoted.

begin;

drop function if exists public.promote_wanted_to_saved_list(text, uuid, uuid, text, text);

alter table public.wanteds
  drop constraint if exists wanteds_promotion_pair_check;

alter table public.wanteds
  drop column if exists promoted_at,
  drop column if exists promoted_list_type;

commit;
