# Client error reporting

`POST /api/client-error` is the app's own crash signal. It is not analytics,
and it must never become analytics. This page says what it carries, what it
refuses, and where the answers come out.

It sits beside `TRACKING_PLAN.md` because a reader looking for "what leaves a
browser" has to find both in one place. The two lanes share nothing else: no
transport, no consent gate, no identity.

## Why it exists

The whole app runs inside a WebView on somebody else's phone. A JavaScript
exception there used to produce nothing anybody would ever see. Vercel logs the
server, and the PostHog `$exception` lane is behind the analytics consent gate,
which is default off. After a staged store rollout the only week-one signal
would have been store reviews.

This is deliberately the small answer: no SDK, no processor, and no new answer
on either privacy form. Anything larger is a decision above the code.

## What a report carries

| Field | What it is | Bound |
| --- | --- | --- |
| `kind` | `error` or `unhandledrejection`. Closed set. | - |
| `name` | The error class, e.g. `TypeError`. Redacted. | `CLIENT_ERROR_NAME_MAX` |
| `message` | The error message. Redacted. | `CLIENT_ERROR_MESSAGE_MAX` |
| `route` | A closed route TEMPLATE, e.g. `/u/[handle]`. Never a URL. | - |
| `shell` | `native` or `web`. | - |
| `ts` | ISO 8601, minted by the server. A browser clock is not evidence. | - |

Nothing else. No person, no device id, no consent identity, no handle, no
coordinates, no free text a reader typed, and no stack: a stack carries file
paths, and a minified one answers nothing the class and message do not.

## What it refuses

- **Query strings and URLs.** Every absolute URL becomes `<url>`; a bare query
  string or fragment is dropped.
- **Emails** become `<email>`, **handles** `<handle>`, **UUIDs** `<id>`.
- **Tokens.** Bearer values, JWTs, long hex strings and any 40-character run
  become `<redacted>`, `<token>` or `<hex>`.
- **A path it does not know.** The route is the closed pageview vocabulary in
  `lib/analyticsPath.ts`, so a plan id, a conversation id and a handle are
  templated out by construction rather than by a regex hoping to catch them.

`lib/clientErrorReport.ts` is the ONE definition of all of that, and
**redaction happens twice**: the browser redacts before sending, and the route
rebuilds the whole report through the same module on arrival, because a route
may never trust what a caller posts and a direct POST is not the reporter.

## Where the answers come out

One structured server log line, and nothing else. No table, no store, no
processor:

```
[pubmax-client-error] {"kind":"unhandledrejection","name":"TypeError","message":"Failed to fetch <url>","route":"/tonight","shell":"native","ts":"2026-09-05T21:14:03.117Z"}
```

Read it in the Vercel runtime logs. Grep the prefix; group by `name` plus
`message` plus `route`.

Because nothing is stored, `app/privacy/page.tsx` needs no change and neither
store's data form gains an answer.

## Guards

- **Public and unauthenticated by design.** A WebView that has just thrown
  cannot be asked to prove anything first.
- **Per-IP budget** through the shared `isLimited` lane
  (`lib/clientErrorRateLimit.ts`, ~20/min).
- **Bounded body** at `CLIENT_ERROR_MAX_BODY_BYTES`; a larger body is dropped
  before it is parsed.
- **204 to everything**, refusals included. A browser that has already thrown
  has nobody home to read a status code, and a 429 tells an abusive caller to
  slow down rather than stop. That is also why no `publicApiError` envelope
  appears in this route: there is no 4xx or 5xx JSON body to put in one.

## The browser half

`components/ClientErrorReporter.tsx`, rendered from the root layout beside
`OfflineReady`. It shows the reader nothing, does not `preventDefault`, so the
console and React's own boundaries are unaffected, and it obeys three rules:

1. **It never re-enters.** A failure inside the reporter cannot itself raise an
   unhandled rejection that would report itself.
2. **One bug is one finding.** Identical reports are sent once, and a session
   sends at most `CLIENT_ERROR_SESSION_CAP` distinct ones.
3. **It sends nothing personal.** See above.

`navigator.sendBeacon` first, because it survives the page going away
mid-crash, which is the case this exists for; a `keepalive` fetch behind it.

The reporter lives inside the root layout, so it never attaches when the root
layout itself throws. `app/global-error.tsx` covers that gap: it sends its own
report through the same `createClientErrorSender()`, which owns all three rules
above, with one cap and dedupe set that outlives each "Try again".

## Pins

- `__tests__/clientErrorReport.test.ts` - the redaction, class by class.
- `__tests__/clientErrorRoute.test.ts` - the route, its budget and its bounds.
- `__tests__/clientErrorReporterRender.test.tsx` - the browser half.
