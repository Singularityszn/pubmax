-- Broadcast outcomes are lost. Previously sent notifications cannot be recalled.
begin;
lock table public.night_signal_broadcasts in access exclusive mode;
insert into public.rate_limits (key, hits, updated_at, expires_at)
select 'night-signal-broadcast:' || version, array[now()], now(), now() + interval '7 days'
from public.night_signal_broadcasts
where state in ('sending', 'delivered', 'unknown')
on conflict (key) do update set
  hits = public.rate_limits.hits || excluded.hits,
  updated_at = excluded.updated_at,
  expires_at = greatest(public.rate_limits.expires_at, excluded.expires_at);
drop function public.settle_night_signal_broadcast(text,uuid,text,integer,integer,integer);
drop function public.claim_night_signal_broadcast(text,uuid);
drop table public.night_signal_broadcasts;
commit;
