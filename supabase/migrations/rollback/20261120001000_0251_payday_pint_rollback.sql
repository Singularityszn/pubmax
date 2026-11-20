-- This removes all payday pint consent and subscription records.
drop function if exists public.confirm_payday_pint(text, timestamptz);
drop table if exists public.payday_pint_pending;
drop table if exists public.payday_pint_subscribers;
