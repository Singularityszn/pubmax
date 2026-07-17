# Wave 0 observability certification

This is the operational status of the provider boundaries defined by
`docs/adr/0007-observability-provider-boundaries.md`. It records evidence; it
does not replace `docs/MASTER_PRD.md`.

## Certified in code

- Product events pass through the closed `ANALYTICS_EVENTS` registry and are
  re-sanitized at `/api/events`.
- No product event, structured analytics log, PostHog event, or Vercel
  pageview is emitted before explicit consent. Do Not Track fails closed.
- Revoking consent removes the local pseudonymous identifier and stops future
  collection.
- Vercel Analytics uses `beforeSend` to cancel pre-consent pageviews. It is not
  a second custom-event rail.
- PostHog capture targets the EU endpoint, disables person-profile processing,
  and receives only registry-known properties plus a coarse templated path.
- The registry contains no streak, freeze, drink-count, alcohol-quantity, or
  consumption-based progression event. Tests pin that absence.
- Supabase remains authoritative for PNC through the service-role-only
  `pnc_qualified_completions` view; browser telemetry cannot increment PNC.

## Provider configuration status

As of 17 July 2026, neither Vercel production project has a
`POSTHOG_PROJECT_API_KEY`. PostHog forwarding and provider-side dashboards are
therefore intentionally inactive. Do not invent a key or create a provider
account from an automated release.

To certify PostHog after the owner supplies an EU project key:

1. Add `POSTHOG_PROJECT_API_KEY` to Production, Preview, and Development for
   both `chengdu` and `pubmax` without exposing it to the browser.
2. Deploy one pinned commit to both projects.
3. Grant analytics consent in a test browser and exercise the activation,
   planning, sharing, return, and Web Vital events.
4. Prove no event is received before consent or under Do Not Track.
5. Create funnels/cohorts from registry event names only. Never capture free
   text, handles, messages, voice content, or coordinates.
6. Record dashboard URLs, retention settings, deletion procedure, project
   region, exact deployment IDs, and a redacted event sample in the Wave 0
   Wayfinder issue.

## Still open

- PostHog EU project/key and provider-side funnel/cohort/error dashboards.
- Vercel production Web Vitals dashboard evidence for both projects.
- Arize Phoenix projects and redacted Pub Pal trace/evaluation certification.
- Consent-gated replay remains disabled pending a separate redaction and
  retention review.
