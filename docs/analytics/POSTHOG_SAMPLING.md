# PostHog browser SDK features

Project: PostHog EU (pubmaxxing.com).

## Off: replay, heatmaps, surveys, identify and flags

- Session replay, heatmaps, surveys and feature flags are off in `posthogBrowserConfig` (`lib/posthogClient.ts`). The privacy page promises all of them are off.
- The browser SDK never calls `identify`. Every browser event carries the consented `anon_` device id only. A browser that a past release identified is reset to a fresh anonymous person when the SDK boots.
- `before_send` (`sanitizePosthogEvent`) keeps only `$pageview`, `$web_vitals` and `$exception`. It cannot see the `/flags` request, so flags stay off at the config level. It keeps `$lib_custom_api_host`, which PostHog's reverse-proxy health check reads.
- `$web_vitals` is the one field-vitals pipeline. There is no `web_vital` product event.
- `$pageleave` is off: it carries time on page and scroll depth, which the privacy page does not list. Turning it on needs a privacy page change in the same PR.
- Capture is batched (`request_batching: true`), so one `/ingest` request carries a page's pageview, vitals and any exception.
- Turning any of these on needs text masking, blocked message, admin and account surfaces, and a privacy page change in the same PR.
- Fence: `__tests__/posthogSdkBoundary.test.ts` drives the real SDK with a stubbed fetch and a server config that switches every feature on.

## Product events

- Named journeys use `trackEvent` → `/api/events` (closed registry in `lib/analyticsEvents.ts`).
- The relay stamps `$lib: "pubmaxx-events-relay"`, the browser SDK's `$session_id` (sent by the browser, UUIDv7-checked by the route) and a `$current_url` / `$pathname` built from the same coarse surface path, so a named event joins its session. Server-originated events carry `$lib: "pubmaxx-server"`.
- Event names for dashboards: `docs/analytics/POSTHOG_EVENT_NAMES.md`.

## Source maps

- Production builds ship no browser source maps. Browser exceptions carry only a safe error type and a redacted value, so a map would deobfuscate nothing.
