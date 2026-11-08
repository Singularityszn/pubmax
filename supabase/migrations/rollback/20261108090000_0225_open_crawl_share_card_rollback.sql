begin;

-- Reverses 20261108090000_0225_open_crawl_share_card.sql.
--
-- COST: an open crawl's link preview loses the places left and price band.
-- The app uses the fallback described by SocialCrewShareCardSource in
-- lib/socialCrew.ts. The host's meeting pub remains available through 0208.
-- If that read fails, the app refuses the card instead of guessing a pub.
-- No table or row changes, so nothing is lost but the function.

drop function if exists public.read_social_crew_share_card(uuid);

commit;
