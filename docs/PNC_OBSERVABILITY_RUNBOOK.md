# Planned Nights Completed observability runbook

`public.plan_completions` is the durable north-star ledger. Operators query the
service-role-only `public.pnc_qualified_completions` view so browser telemetry,
lost HTTP responses, retries, recap views, and legacy unqualified rows cannot
inflate Planned Nights Completed (PNC).

## Canonical queries

Run these through an authenticated server or the Supabase SQL editor. Never put
the service-role key in a browser, dashboard embed, or client bundle.

Daily PNC:

```sql
select completion_day_utc, count(*) as planned_nights_completed
from public.pnc_qualified_completions
where completed_at >= now() - interval '30 days'
group by completion_day_utc
order by completion_day_utc;
```

Ending mix:

```sql
select ending, count(*) as planned_nights_completed
from public.pnc_qualified_completions
where completed_at >= now() - interval '30 days'
group by ending
order by planned_nights_completed desc;
```

Integrity checks:

```sql
select
  count(*) as qualified_rows,
  count(distinct completion_id) as distinct_completions,
  count(distinct plan_id) as distinct_plans
from public.pnc_qualified_completions;
```

All three values must match. A mismatch is a release blocker even though the
underlying table also has unique constraints.

## Provider boundary

- Supabase is authoritative for PNC.
- PostHog EU measures consented interaction funnels; it is not the PNC counter.
- Vercel owns deployment/runtime evidence and Web Vitals.
- Arize is reserved for redacted Pub Pal AI traces and evaluations.

The view contains completion and Plan UUIDs for idempotency audits, timestamps,
ending, and route revision. It contains no account identifiers, member tokens,
handles, names, free text, venue names, voice content, or coordinates.

## Dashboard certification

Provider-side dashboards are certified only after an operator records the
workspace/region, dashboard URL, query or insight version, owner, alert threshold,
and a screenshot from the exact production release. Repository code alone is not
evidence that a PostHog, Vercel, or Arize dashboard exists.
