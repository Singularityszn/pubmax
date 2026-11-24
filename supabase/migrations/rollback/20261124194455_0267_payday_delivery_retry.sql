-- Pending retry state and attempt history are lost. Existing weekly claims remain.
drop function public.finish_payday_pint_delivery(uuid, text, uuid, text);
drop function public.claim_payday_pint_delivery(uuid, text, uuid, timestamptz);
alter table public.payday_pint_subscribers drop column delivery_state, drop column delivery_attempts, drop column delivery_claim, drop column delivery_claimed_at;
