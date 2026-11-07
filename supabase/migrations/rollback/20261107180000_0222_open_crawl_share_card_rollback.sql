begin;

-- Reverses 20261107180000_0222_open_crawl_share_card.sql.
--
-- COST: an open crawl's link preview loses the places left, the host's chosen
-- meeting pub and the price band. The app falls back to the 0115 public
-- preview (title, host, time and Stop 1), so a shared link still unfurls.
-- No table or row changes, so nothing is lost but the function.

drop function if exists public.read_social_crew_share_card(uuid);

commit;
