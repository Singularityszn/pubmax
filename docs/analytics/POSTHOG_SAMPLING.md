# PostHog browser SDK features

Project: PostHog EU (pubmaxxing.com).

## Off: replay, heatmaps, surveys, identify and flags

- Session replay, heatmaps, surveys and feature flags are off in `posthogBrowserConfig` (`lib/posthogClient.ts`). The privacy page promises all of them are off.
- The browser SDK never calls `identify`. Every browser event carries the consented `anon_` device id only. A browser that a past release identified is reset to a fresh anonymous person when the SDK boots.
- `before_send` (`sanitizePosthogEvent`) keeps only `$pageview`, `$pageleave`, `$web_vitals`, `$exception` and the closed `map_load_timing` shape (`lib/mapLoadTimingEvent.ts`). It cannot see the `/flags` request, so flags stay off at the config level. It keeps `$lib_custom_api_host`, which PostHog's reverse-proxy health check reads.
- `$web_vitals` is the one field-vitals pipeline. There is no `web_vital` product event.
- The SDK sends the final `$pageleave` by beacon. An internal navigation carries the previous visit's measurements on the next explicit `$pageview`. The filter keeps UUID page identifiers, coarse paths, duration in seconds from 0 to 86,400, and scroll proportions from 0 to 1. It drops pixel positions and free text. Message, account (including `/activity`) and admin pages carry no engagement measurements. An excluded route interrupts previous-visit measurements. The [privacy notice](../../app/privacy/page.tsx) describes this collection.
- Every consent grant suppresses previous-visit measurements on the first pageview, whether queued or captured directly. Its final exit measures only the new visit. Later pageviews retain valid measurements within that consent period. Views replayed after the SDK loads omit measurements for earlier queued visits, which the SDK could not observe accurately. Regression cases: `__tests__/posthogSdkBoundary.test.ts` and `__tests__/posthogPageviews.test.ts`.
- Capture is batched (`request_batching: true`), so one `/ingest` request carries a page's pageview, vitals and any exception.
- Turning any of these on needs text masking, blocked message, admin and account surfaces, and a privacy page change in the same PR.
- Fence: `__tests__/posthogSdkBoundary.test.ts` drives the real SDK with a stubbed fetch and a server config that switches every feature on.

## Product events

- Named journeys use `trackEvent` → `/api/events` (closed registry in `lib/analyticsEvents.ts`).
- The relay stamps `$lib: "pubmaxx-events-relay"`, the browser SDK's `$session_id` (sent by the browser, UUIDv7-checked by the route) and a `$current_url` / `$pathname` built from the same coarse surface path, so a named event joins its session. It still carries no `$host`; `environment` is the filter. A session id minted on a clock up to 5 minutes ahead moves the event's timestamp up to the session start (PostHog drops an event dated before its session); further ahead, the session id is dropped. Server-originated events carry `$lib: "pubmaxx-server"`.
- Event names for dashboards: `docs/analytics/POSTHOG_EVENT_NAMES.md`.

## Source maps

- Production builds ship no browser source maps. Browser exceptions carry only a safe error type and a redacted value, so a map would deobfuscate nothing.
