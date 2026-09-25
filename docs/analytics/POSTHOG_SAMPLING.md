# PostHog sampling (free tier)

Project: PostHog EU (pubmaxxing.com).

## Session replay

- **Sample rate:** `0.1` (10% of consented sessions), defined in `lib/posthog/posthogSampling.ts` as `POSTHOG_SESSION_RECORDING_SAMPLE_RATE`.
- Replay only starts after analytics consent; the browser SDK uses the first-party `/ingest` proxy.
- At ~60 monthly visitors this stays well inside PostHog's free replay allowance; raise the rate only after checking the PostHog usage dashboard.

## Product events

- Named journeys use `trackEvent` → `/api/events` (closed registry in `lib/analyticsEvents.ts`).
- Event names for dashboards: `docs/analytics/POSTHOG_EVENT_NAMES.md`.

## Heatmaps

- Enabled via `capture_heatmaps` on the browser SDK (not full DOM autocapture).
