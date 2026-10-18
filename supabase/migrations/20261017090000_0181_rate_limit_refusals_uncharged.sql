-- 0181: a refused rate-limit hit is not recorded.
-- Captain applies. Agents ship SQL only.
--
-- Before. 0070's check_rate_limit and charge_round_price_line appended now()
-- to the key's hits on EVERY call and then compared, so a refused call still
-- cost a stamp. Under a flood one key's array grew to the request rate times
-- the window, and every later call rewrote that whole array (LIB-S3).
--
-- After. Both functions read the key's live hits under a row lock, compare
-- first, and append only when the call is admitted. A refused call keeps the
-- pruned live hits and leaves expires_at alone, so a key never holds more than
-- p_limit stamps and each refusal costs the same as the first. The verdict is
-- unchanged: a call is refused once p_limit hits are already live, which is
-- what `cardinality(hits || now()) > p_limit` answered before. Signatures,
-- grants and the round line-charge receipts are unchanged.
--
-- Reverse: supabase/migrations/rollback/20261017090000_0181_rate_limit_refusals_uncharged_rollback.sql

begin;

create or replace function public.check_rate_limit(
  p_key text,
  p_limit integer,
  p_window_ms integer
)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare
  cutoff timestamptz := now() - make_interval(secs => p_window_ms / 1000.0);
  live timestamptz[];
  limited boolean;
begin
  perform public.prune_expired_rate_limits();

  insert into public.rate_limits (key, expires_at)
  values (
    p_key,
    now() + make_interval(secs => p_window_ms / 1000.0)
  )
  on conflict (key) do nothing;

  select array(
           select hit
             from unnest(r.hits) hit
            where hit > cutoff
         )
    into live
    from public.rate_limits r
   where r.key = p_key
   for update;

  limited := cardinality(live) >= p_limit;

  update public.rate_limits
     set hits = case when limited then live else live || now() end,
         updated_at = now(),
         expires_at = case
           when limited then expires_at
           else now() + make_interval(secs => p_window_ms / 1000.0)
         end
   where key = p_key;

  return limited;
end;
$$;

create or replace function public.charge_round_price_line(
  p_actor text,
  p_key text,
  p_limit integer,
  p_line_index integer,
  p_spend_id uuid,
  p_window_ms integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items jsonb;
  v_owner text;
  v_receipt_actor text;
  v_cutoff timestamptz;
  v_live timestamptz[];
begin
  if
    nullif(trim(p_actor), '') is null
    or nullif(trim(p_key), '') is null
    or p_limit < 0
    or p_line_index < 0
    or p_window_ms <= 0
  then
    return 'forbidden';
  end if;

  select items, promotion_actor
    into v_items, v_owner
    from public.round_spends
   where id = p_spend_id
   for update;

  if not found or v_owner is distinct from p_actor then
    return 'forbidden';
  end if;

  select actor
    into v_receipt_actor
    from public.round_price_line_charges
   where spend_id = p_spend_id
     and line_index = p_line_index;

  if found then
    return case
      when v_receipt_actor = p_actor then 'already_charged'
      else 'forbidden'
    end;
  end if;

  if
    p_line_index >= jsonb_array_length(v_items)
    or v_items->p_line_index->>'promotionStatus' <> 'pending'
  then
    return 'forbidden';
  end if;

  perform public.prune_expired_rate_limits();
  v_cutoff := now() - make_interval(secs => p_window_ms / 1000.0);

  insert into public.rate_limits (key, expires_at)
  values (
    p_key,
    now() + make_interval(secs => p_window_ms / 1000.0)
  )
  on conflict (key) do nothing;

  select array(
           select hit
             from unnest(r.hits) hit
            where hit > v_cutoff
         )
    into v_live
    from public.rate_limits r
   where r.key = p_key
   for update;

  if cardinality(v_live) >= p_limit then
    update public.rate_limits
       set hits = v_live,
           updated_at = now()
     where key = p_key;
    return 'limited';
  end if;

  insert into public.round_price_line_charges (
    spend_id,
    line_index,
    actor
  )
  values (
    p_spend_id,
    p_line_index,
    p_actor
  );

  update public.rate_limits
     set hits = v_live || now(),
         updated_at = now(),
         expires_at = now() + make_interval(secs => p_window_ms / 1000.0)
   where key = p_key;

  return 'charged';
end;
$$;

commit;
