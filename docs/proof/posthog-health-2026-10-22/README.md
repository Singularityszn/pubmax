# PostHog page-exit health repair

## Reported problem

On 22 October 2026, project 219466 reported one active warning:
`no_pageleave_events`, issue `019fabfb-6168-7e8a-802c-fb1172366447`.
The seven-day diagnostic query returned 91 `$pageview` events and zero
`$pageleave` events. The event taxonomy contained no pageleave event.

Source: [project health](https://eu.posthog.com/project/219466/web/health).
PostHog's [pageleave guidance](https://posthog.com/docs/health-checks/pageleave-events)
explains the resulting gap in duration and bounce measurements.

## Cause and change

The app set `capture_pageleave: false`. Its closed browser event filter also
rejected pageleave events. The privacy notice did not describe duration or
scroll depth.

The [browser SDK contract](../../analytics/POSTHOG_SAMPLING.md) owns the
current collection limits. The [privacy notice](../../../app/privacy/page.tsx)
describes them for users.

## Initial implementation evidence

The results below describe the initial implementation through `bd06e7e1a`.
They predate the consent repair in `59b3026c4` and the Activity exclusion
in `c698a247c`. They do not validate those runtime changes.

The real SDK regression command was:

```sh
npm test -- __tests__/posthogSdkBoundary.test.ts
```

Before the production change, its pageleave assertion failed:

```text
expected [] to have a length of 1 but got 0
1 failed | 6 passed
```

After the change, the real SDK suite passed eight tests. It checks the
final exit, previous-visit measurements, anonymous identity, the proxy,
batching and the disabled browser features.

A browser probe against production also reproduced two pageviews and zero
pageleave events. Capture requests were intercepted, so this probe added no
events to the production project.

The initial local build passed the pageleave browser test. It checks two
pageviews, their linked previous-visit measurements, and one pageleave
with bounded duration and scroll proportion. The test dispatches pagehide
while retaining the document. Chromium can discard an intercepted unload
request when navigation destroys that document, so this test does not
establish production delivery during a real browser exit.

A separate probe observed the native beacon during a real browser reload.
The same probe found no pageleave beacon on production and one accepted
pageleave beacon on the fixed local build. It preserved the native Blob
and sendBeacon calls while recording their inputs. This proves that the
browser queues the event during native pagehide. Provider receipt remains
a production release check.

## Initial validation and current limits

- `npm run verify` passed. Unit coverage reported 42,504 passes and one
  deliberate skip. PostgreSQL runs reported 679 and 10 passes.
- The initial focused run passed 87 tests across five suites.
- The initial production build passed.
- Changed TypeScript files passed ESLint.
- The browser checks cover acceptance, refusal and the pagehide beacon.
- Freshness checks reported two advisory stale datasets and three
  unmeasurable store feeds. They did not report those feeds as fresh.

This evidence uses branch `codex/posthog-health-1022`, based on
`325122c23eb9d8bc809c4388448c0e5459146152`.
The Test phase must rebuild the current source in an isolated production
artifact before browser validation. The earlier localhost:3317 server does
not prove the consent and Activity repairs.
No migration is required. Production deployment and fresh production
ingestion remain release checks. The warning clears only after PostHog
receives pageleave events and its scheduled health check runs again.
