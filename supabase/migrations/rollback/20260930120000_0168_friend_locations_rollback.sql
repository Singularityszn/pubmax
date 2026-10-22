begin;
drop function public.purge_friend_locations();
drop function public.friend_location_operation(uuid,text,jsonb);
drop table public.private_friend_location_grants;
drop table public.private_friend_location_sessions;
drop table public.private_friend_location_generations;
drop function public.friend_location_grant_bound();
drop function public.friend_location_account_live(uuid);
commit;
