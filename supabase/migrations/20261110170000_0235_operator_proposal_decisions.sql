begin;

create function public.decide_operator_proposal(p_id text, p_status text, p_note text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  proposal_id uuid;
  proposal public.operator_proposals%rowtype;
  fact public.operator_facts%rowtype;
  decided_at timestamptz := clock_timestamp();
begin
  if p_status is null or p_status not in ('accepted', 'declined') then
    raise exception using errcode = '22023', message = 'invalid_operator_proposal_decision';
  end if;
  begin
    proposal_id := p_id::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('outcome', 'missing');
  end;

  select p.* into proposal from public.operator_proposals p where p.id = proposal_id for update;
  if not found then return jsonb_build_object('outcome', 'missing'); end if;
  if (p_status = 'accepted' and proposal.status <> 'pending')
     or (p_status = 'declined' and proposal.status not in ('pending', 'accepted')) then
    return jsonb_build_object('outcome', 'conflict');
  end if;

  if p_status = 'accepted' then
    insert into public.operator_facts (
      proposal_id, venue_id, account_id, kind, title, body, field, when_text, on_date, published_at
    ) values (
      proposal.id, proposal.venue_id, proposal.account_id, proposal.type,
      nullif(btrim(proposal.payload->>'title'), ''), nullif(btrim(proposal.payload->>'body'), ''),
      case when proposal.type = 'correction' then nullif(btrim(proposal.payload->>'field'), '') end,
      case when proposal.type = 'event' then nullif(btrim(proposal.payload->>'startsAt'), '') end,
      case when proposal.type in ('event', 'offer') then nullif(btrim(proposal.payload->>'onDate'), '')::date end,
      decided_at
    ) on conflict on constraint operator_facts_proposal_unique do update set
      venue_id = excluded.venue_id, account_id = excluded.account_id, kind = excluded.kind,
      title = excluded.title, body = excluded.body, field = excluded.field,
      when_text = excluded.when_text, on_date = excluded.on_date,
      published_at = excluded.published_at, withdrawn_at = null
    returning * into fact;
  else
    update public.operator_facts f set withdrawn_at = decided_at
      where f.proposal_id = proposal.id and f.withdrawn_at is null;
  end if;

  update public.operator_proposals p set
    status = p_status, reviewed_at = decided_at,
    reviewer_note = coalesce(nullif(p_note, ''), p.reviewer_note)
    where p.id = proposal.id returning p.* into proposal;

  if p_status = 'declined' then return jsonb_build_object('outcome', 'declined'); end if;
  return jsonb_build_object('outcome', 'accepted', 'proposal', to_jsonb(proposal), 'fact', to_jsonb(fact));
end;
$$;

revoke all on function public.decide_operator_proposal(text, text, text) from public, anon, authenticated;
grant execute on function public.decide_operator_proposal(text, text, text) to service_role;

commit;
