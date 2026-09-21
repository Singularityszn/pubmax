-- 0157: Server-issued voice grants reserve the full three-minute cap up front.
-- Client completion never refunds. Only server failure before handing out a
-- provider URL can refund its unique grant, once. No precise usage claim.
begin;
create table public.pub_pal_voice_grants (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  usage_month date not null,
  refunded boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.pub_pal_voice_grants enable row level security;
revoke all on public.pub_pal_voice_grants from public, anon, authenticated;
grant select, insert, update, delete on public.pub_pal_voice_grants to service_role;
create index pub_pal_voice_grants_owner_month on public.pub_pal_voice_grants(owner_id, usage_month);

create function public.prepay_pub_pal_voice_grant(p_owner_id uuid, p_month date, p_grant_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare inserted uuid; admitted integer;
begin
  if p_month is null or p_month <> date_trunc('month', p_month)::date then return false; end if;
  insert into public.pub_pal_voice_grants(id, owner_id, usage_month)
    values(p_grant_id, p_owner_id, p_month) on conflict do nothing returning id into inserted;
  -- A retried grant may not mint another provider URL, even after refund.
  if inserted is null then return false; end if;
  insert into public.pub_pal_voice_usage(owner_id, usage_month, session_count, used_minutes)
    values(p_owner_id, p_month, 0, 3)
  on conflict(owner_id, usage_month) do update
    set used_minutes = public.pub_pal_voice_usage.used_minutes + 3
    where public.pub_pal_voice_usage.used_minutes <= 27
  returning used_minutes into admitted;
  if admitted is null then
    delete from public.pub_pal_voice_grants where id = p_grant_id;
    return false;
  end if;
  return true;
end;
$$;
create function public.refund_pub_pal_voice_grant(p_owner_id uuid, p_grant_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare grant_month date;
begin
  update public.pub_pal_voice_grants set refunded = true
    where id = p_grant_id and owner_id = p_owner_id and not refunded
    returning usage_month into grant_month;
  if grant_month is null then return false; end if;
  update public.pub_pal_voice_usage set used_minutes = greatest(0, used_minutes - 3)
    where owner_id = p_owner_id and usage_month = grant_month;
  return true;
end;
$$;
revoke all on function public.prepay_pub_pal_voice_grant(uuid,date,uuid) from public, anon, authenticated;
revoke all on function public.refund_pub_pal_voice_grant(uuid,uuid) from public, anon, authenticated;
grant execute on function public.prepay_pub_pal_voice_grant(uuid,date,uuid) to service_role;
grant execute on function public.refund_pub_pal_voice_grant(uuid,uuid) to service_role;
commit;
