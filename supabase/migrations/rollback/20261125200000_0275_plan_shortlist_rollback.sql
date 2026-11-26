-- Removes the shortlist and votes. Confirmed Plans retain their chosen pub and start time.
drop function public.mutate_plan_shortlist_atomic(uuid,text,text,uuid,text,timestamptz,timestamptz);
drop function public.create_plan_shortlist_atomic(uuid,text,timestamptz,uuid,text,text,timestamptz,text,text,jsonb,jsonb);
drop table public.plan_shortlists;
