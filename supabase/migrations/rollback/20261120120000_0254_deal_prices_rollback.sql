-- This removes all contributed deal prices, schedules and reports.
drop function if exists public.list_deals_for_review();
drop function if exists public.moderate_deal_price(uuid, uuid, boolean);
drop function if exists public.report_deal_price(uuid, text);
drop table if exists public.deal_price_reports;
drop table if exists public.deal_prices;
