-- Retry payloads and cursor are lost. Delivery claims remain reserved.
drop function public.advance_price_alert_retry(text,uuid,uuid,text);
drop function public.dismiss_price_alert_retry(uuid,text);
drop function public.price_alert_retry_page(uuid,text,integer);
drop function public.claim_price_alert_event(uuid,text,text,text,integer,timestamptz,uuid,jsonb);
create or replace function public.price_alert_delivery_backlog()
returns table (retryable bigint, uncertain bigint, oldest_pending timestamptz, failed bigint)
language sql stable security invoker set search_path = '' as $$
  select count(*) filter (where delivery_state = 'retryable'),
    count(*) filter (where delivery_state in ('sending', 'unknown')),
    min(queued_at) filter (where delivery_state in ('retryable', 'sending', 'unknown')),
    count(*) filter (where delivery_state = 'terminal')
  from public.price_alert_claims;
$$;

alter table public.price_alert_snapshot_jobs drop column retry_user, drop column retry_event;
alter table public.price_alert_claims drop column event_payload, drop column recorded_at;
