-- 0165: Capture verified stop evidence when the completion writes route history.
-- Both completion RPC overloads insert a venue-only snapshot. The trigger adds
-- evidence from the saved stop in that same transaction, before the snapshot
-- becomes immutable completion history.

create function public.plan_completion_capture_selected_drink_evidence()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  select jsonb_agg(
    case when stop.selected_drink_price_evidence is not null
      then item.value || jsonb_build_object('selectedDrinkPriceEvidence', stop.selected_drink_price_evidence)
      else item.value
    end order by item.ordinality
  ) into new.route_snapshot
  from jsonb_array_elements(new.route_snapshot) with ordinality as item(value, ordinality)
  left join public.plan_stops stop
    on stop.plan_id = new.plan_id
   and stop.position::text = item.value->>'position'
   and stop.venue_id = item.value->>'venueId';
  return new;
end;
$$;

revoke all on function public.plan_completion_capture_selected_drink_evidence() from public, anon, authenticated;
grant execute on function public.plan_completion_capture_selected_drink_evidence() to service_role;

create trigger plan_completion_capture_selected_drink_evidence
before insert on public.plan_completions
for each row execute function public.plan_completion_capture_selected_drink_evidence();
