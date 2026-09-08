-- Rollback loses submission replay identity. Keep every Pint Drop and Storage key.
-- Stop keyed writers first. Their requests must fail closed after this rollback.
begin;
drop function if exists public.create_pint_drop_idempotent(text, text, jsonb);
drop table if exists public.pint_drop_create_requests;
commit;
