-- Rolling back 0161 discards saved selected-drink evidence; routes remain.

alter table public.plan_stops
  drop column if exists selected_drink_price_evidence;
