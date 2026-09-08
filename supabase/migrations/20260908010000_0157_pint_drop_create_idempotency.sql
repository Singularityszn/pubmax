-- 0157: recover a committed Pint Drop after its success response is lost.
-- Apply after 0153. The captain applies SQL; this migration writes no historical keys.
begin;

create table public.pint_drop_create_requests (
  actor_key_hash text primary key check (actor_key_hash ~ '^[0-9a-f]{64}$'),
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  drop_id uuid not null references public.pint_drops(id) on delete restrict
);
comment on table public.pint_drop_create_requests is
  'Private submission replay records. The server hashes verified account UUID with the client key. Retain while the contribution exists, including account retirement.';
alter table public.pint_drop_create_requests enable row level security;
revoke all on public.pint_drop_create_requests from public, anon, authenticated;
grant select, insert, update, delete on public.pint_drop_create_requests to service_role;

create function public.create_pint_drop_idempotent(
  p_actor_key_hash text,
  p_request_digest text,
  p_drop jsonb
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  prior public.pint_drop_create_requests%rowtype;
  candidate public.pint_drops%rowtype;
  saved public.pint_drops%rowtype;
  violated_constraint text;
begin
  if p_actor_key_hash is null or p_actor_key_hash !~ '^[0-9a-f]{64}$'
    or p_request_digest is null or p_request_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid Pint Drop request hash' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pint-drop:create:' || p_actor_key_hash, 0));
  select * into prior from public.pint_drop_create_requests
    where actor_key_hash = p_actor_key_hash;
  if found then
    if prior.request_digest <> p_request_digest then
      return jsonb_build_object('outcome', 'conflict');
    end if;
    select * into strict saved from public.pint_drops where id = prior.drop_id;
    return jsonb_build_object('outcome', 'replayed', 'drop', to_jsonb(saved));
  end if;

  candidate := jsonb_populate_record(null::public.pint_drops, p_drop);
  -- The route owns the cap. Unpriced rows never claim a day.
  if candidate.price_gbp is not null and candidate.price_day is not null then
    candidate.price_day := (candidate.created_at at time zone 'Europe/London')::date;
    perform pg_advisory_xact_lock(hashtextextended(
      'pint-drop:day:' || jsonb_build_array(candidate.venue_id, candidate.handle, candidate.price_day)::text, 0));
    -- Keep the soft check's coverage of older and community-paired rows with no day stamp.
    if exists (
      select 1 from public.pint_drops
      where venue_id = candidate.venue_id and handle = candidate.handle
        and price_gbp is not null and status <> 'hidden'
        and (created_at at time zone 'Europe/London')::date = candidate.price_day
    ) then
      return jsonb_build_object('outcome', 'daily_cap');
    end if;
  else
    candidate.price_day := null;
  end if;

  begin
    insert into public.pint_drops (
      id, venue_id, handle, drink, measure, measure_label, price_gbp,
      passed_down_note, era, vibe_tags, visibility, pint_photo_key,
      venue_photo_key, receipt_photo_key, provenance, status, created_at,
      authority_key, price_day, leave_by_iso, last_train_decision
    ) values (
      candidate.id, candidate.venue_id, candidate.handle, candidate.drink,
      candidate.measure, candidate.measure_label, candidate.price_gbp,
      candidate.passed_down_note, candidate.era, candidate.vibe_tags,
      candidate.visibility, candidate.pint_photo_key, candidate.venue_photo_key,
      candidate.receipt_photo_key, candidate.provenance, 'visible', candidate.created_at,
      candidate.authority_key, candidate.price_day, candidate.leave_by_iso, candidate.last_train_decision
    ) returning * into saved;
    insert into public.pint_drop_create_requests(actor_key_hash, request_digest, drop_id)
      values (p_actor_key_hash, p_request_digest, saved.id);
  exception when unique_violation then
    get stacked diagnostics violated_constraint = constraint_name;
    if violated_constraint = 'pint_drops_priced_day_unique_idx' then
      return jsonb_build_object('outcome', 'daily_cap');
    end if;
    raise;
  end;
  return jsonb_build_object('outcome', 'created', 'drop', to_jsonb(saved));
end;
$$;
revoke all on function public.create_pint_drop_idempotent(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_pint_drop_idempotent(text, text, jsonb) to service_role;
commit;
