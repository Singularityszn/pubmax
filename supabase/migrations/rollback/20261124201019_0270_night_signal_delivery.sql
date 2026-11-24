-- Broadcast outcomes are lost. Previously sent notifications cannot be recalled.
drop function public.settle_night_signal_broadcast(text,uuid,text,integer,integer,integer);
drop function public.claim_night_signal_broadcast(text,uuid);
drop table public.night_signal_broadcasts;
