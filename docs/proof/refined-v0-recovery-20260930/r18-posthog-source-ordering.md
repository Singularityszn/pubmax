# PostHog identity and initialization ordering - R18 source receipt

Reviewed 2026-09-30. Checkout: `/Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx`.

Scope: source-only review of current app and installed SDK. No browser, tests,
build, install, network, index, production changes or publication. This file is a
temporary review receipt, not an implementation or runtime validation result.

## Authority and recommendation status

**Recommendation is conditional on pending human policy choice.** Current
committed policy requires anonymous device analytics, but coordinator explicitly
reports a pending human decision. This receipt does not authorize identity repair,
change policy, waive gates, or recommend joining accounts through another channel.
If human choice preserves current anonymous channel, bounded repair below applies.
If policy changes, re-review collection, consent, sanitizer, documentation and
actual SDK transport together before implementation.

Current source policy:

- `docs/analytics/TRACKING_PLAN.md:32-33`: no account identity ever joins analytics
  ID; ADR 0009 owns this decision.
- `docs/analytics/METRICS.md:65-68`: repeats that account identity never joins
  pseudonymous ID and points to tracking plan.
- `docs/adr/0009-standard-product-analytics.md:5,22`: accepted ADR; consent creates
  persistent pseudonymous device identifier. Review is about identity ownership,
  not a new decision about replay, surveys, profiles or backend architecture.

## Reachable conflict and telemetry loss

- `components/auth/AuthProvider.tsx:423-424` calls
  `syncPosthogPersonIdentity(nextUserId)` after updating canonical session.
- `lib/posthog/posthogPerson.ts:16-26` waits for consented SDK, checks UUID syntax,
  then calls real SDK `identify(userId)`. On null account, lines21-22 reset only
  when current SDK distinct ID is a UUID.
- Installed `node_modules/posthog-js/package.json:3` is **1.435.1**. These findings
  use that installed version, not inferred behavior from version range or docs.
- Installed `lib/src/posthog-core.js:2779,2792` registers `$user_id` and account
  `distinct_id` before `$identify` capture/sanitization. Its identified-state
  transition occurs2803/2824; flag reload occurs2846/2855.
- App `lib/posthogClient.ts:326` installs `before_send`; SDK applies it at
  `lib/src/posthog-core.js:1568`. Rejecting `$identify` does not undo earlier
  SDK state/persistence mutation.
- Installed `lib/src/posthog-featureflags.js:957-960` builds flags payload using
  `distinct_id`, `$anon_distinct_id`, device and stored person properties. This
  request bypasses app event sanitizer. UUID plus previous anonymous identity
  constitutes account/device joining even when `$identify` itself is dropped.
- App pageview sanitizer `lib/posthogClient.ts:206-212` requires anonymous marker
  and equality with SDK-enriched `distinct_id`. After identify, SDK supplies UUID,
  so real pageviews are rejected. Vitals233 and exceptions245 also require
  anonymous SDK identity. Account analytics helper therefore conflicts with
  policy and can drop allowed signed-in pageviews, vitals and exceptions.

This is source-proven reachability. No new runtime reproduction occurred in this
review. Existing fake-client identity tests do not prove actual SDK behavior.

## Exact installed initialization order

Paths below relative to `node_modules/posthog-js`:

| Source | What happens | Ordering consequence |
| --- | --- | --- |
| `lib/src/posthog-core.js:633-656` | Persistence created/read; initial property snapshots taken | Legacy SDK identity can already be present |
| `lib/src/posthog-core.js:675-689` | Flags enrolled; extensions initialized | Happens before bootstrap and loaded callback |
| `lib/src/posthog-featureflags.js:687-715` | `initialize()` consumes bootstrapped flag values, otherwise returns | This method itself makes no initial HTTP request |
| `lib/src/posthog-core.js:708-747` | Bootstrap identity applied | `isIdentifiedID:false` replaces distinct/device IDs and marks anonymous; does not identify/merge |
| `lib/src/posthog-core.js:756-766` | `get_device_id` seeds IDs only when distinct ID missing | Existing UUID is not repaired by current resolver alone |
| `lib/src/posthog-core.js:788-791` | Without Segment, `_loaded()` called synchronously | Current app config has no Segment integration |
| `lib/src/posthog-core.js:1030-1038` | Calls `config.loaded(this)`, then starts queue | Loaded callback precedes ordinary queue start |
| `lib/src/posthog-core.js:1050-1059` | Schedules initial SDK pageview if enabled; starts remote-config load | Both occur after loaded callback; app automatic pageview is disabled |
| `lib/src/remote-config.js:38-100` | Loads remote config, then `ensureFlagsLoaded()` | Ordinary first flags request follows loaded callback |
| `lib/src/posthog-featureflags.js:928-933` | `ensureFlagsLoaded()` calls reload if no loaded/in-flight/debounced flags | Early enrollment does not itself perform this request |
| App `lib/posthogClient.ts:361-385` | `init()` returns, app opts in, then flushes pending pageviews | Synchronous loaded cleanup can precede all app queued pageviews |

**Current app has no loaded callback**: `lib/posthogClient.ts:287-327`.
`instrumentation-client.ts:4` starts from consent permission only; it does not
first obtain canonical `anonymousAnalyticsId()`.

Do not overstate callback ordering. Exception/vitals observers initialize before
bootstrap/loaded: `lib/src/posthog-core.js:909,912`;
`lib/src/extensions/exception-autocapture/index.js:20-58` installs wrappers when
available; `lib/src/extensions/web-vitals/index.js:93-262` prepares native metric
observers/flush. Loaded callback precedes normal first flags and app pageviews,
but source does not establish that it precedes every conceivable extension
capture. Retain fail-closed sanitizer and validate native extension transport.

SDK catches errors thrown by loaded callback (`posthog-core.js:1031-1037`), then
continues initialization. Throwing there is not a supported stop-initialization
mechanism; repair must not equate a thrown normalizer with successful cleanup.

## Conditional minimum anonymous-channel repair

1. Remove production UUID identify bridge and obsolete account identity helper
   where no callers remain. Do not postpone auth bootstrap or account updates.
2. Obtain ID through existing `lib/analytics.ts:234` anonymous owner before
   consented SDK init. Reuse that ID across SDK and explicit pageview marker;
   do not add another generator/allowlist. Pass ownership through startup and
   consent seams without introducing an import cycle.
3. Use supported init bootstrap `{ distinctID: anonymousId,
   isIdentifiedID: false }`. Installed core741-747 assigns both anonymous distinct
   and device IDs. Never use identified bootstrap: core715-727 may call identify
   and merge existing anonymous identity.
4. In synchronous loaded callback, detect legacy residual `$user_id` via public
   `get_property`. For contaminated state only, public
   `reset({ resetDeviceID: true, bootstrap: { distinctID: anonymousId,
   isIdentifiedID: false } })` clears persisted account state and flag ancestry.
   Reset every healthy document would unnecessarily split sessions.
5. Ensure `get_device_id` resolves current canonical ID even if localStorage
   fails. Current resolver184-190 sees localStorage only and falls back to raw
   SDK-generated UUID; app anonymous owner also has an in-memory fallback.
6. Preserve consent revision checks and existing opt-in/queued-pageview ordering.
   Reset before opt-in. Ordinary account switch/logout should not identify or
   rotate an otherwise healthy anonymous device identity. Preserve actual auth
   logout/cleanup and consent denial/regrant behavior.

Supported API evidence:

- `dist/module.d.ts:4537-4563`: documented reset device ID and anonymous bootstrap
  options; explicit warning that reset clears consent, so opt-in must follow.
- `node_modules/@posthog/types/dist/posthog-config.d.ts:142-177`: public
  `BootstrapConfig`/`ResetOptions`, including `isIdentifiedID` and `resetDeviceID`.
- `lib/src/posthog-core.js:3216-3321`: reset clears persistence3258, flag state3266,
  cached person state3272; applies bootstrap3293-3297; reloads flags3321.
- `lib/src/posthog-featureflags.js:1811-1820`: reset invalidates request generation,
  clears debouncer and `$anon_distinct_id`.

Bootstrap alone changes identity but leaves legacy `$user_id` super property.
Reset alone after ordinary init is later than remote-config startup. Pairing
anonymous bootstrap with bounded loaded cleanup avoids both mistakes. Actual
first-wire regression remains required before claiming safe recovery.

## Proposed real SDK regression, no fake client or direct fake capture

Reuse `e2e/analytics-consent.spec.ts` and
`e2e/helpers/posthogIngest.ts` wire decoder with existing inert public token.
Use installed SDK transport; do not substitute a mocked identify/capture client.

### Legacy persisted UUID first document

- Fulfill a same-origin scratch HTML document and SDK module URL through test
  routes. Module response comes from installed bundled public
  `posthog-js/dist/module.js` ESM artifact, not generated Next chunk filename or
  SDK private persistence schema.
- In scratch document, use real SDK public `init`, `opt_in_capturing` and
  `identify(fixtureUUID)` to create actual legacy cookie/localStorage state.
  Seed app canonical anonymous ID and granted consent. Intercept all seed traffic
  locally; do not send fixture identity to a real project.
- Verify public SDK distinct ID became fixture UUID, then navigate to fresh
  production document in same context. Scratch SDK object disappears; SDK-created
  persistence remains. Separate seed traffic from production assertions.
- Assert **first identity-bearing flags request**, first real app pageview and
  subsequent allowed events use canonical anonymous ID. Assert no fixture UUID,
  legacy `$user_id` or account/anonymous join appears in flags ancestry/event
  properties or resulting SDK persistence. Decode flags body separately from
  capture envelopes. Config GETs carrying only token are not identity events.

### Real account transition after SDK readiness

- Reuse real Supabase SDK doubles and UI switch journey from
  `e2e/account-switch-identity.spec.ts:289`. Seed both accounts under denied
  consent, accept through UI, and wait for real anonymous pageview transport.
- Switch accounts through actual switcher, navigate via real UI, then sign out
  and navigate again. Each allowed pageview must arrive anonymously; no identity
  joins may appear. This is deterministic for current bug because identify runs
  after SDK is ready, rather than racing cold SDK initialization.
- `e2e/helpers/authDoubles.ts:150` forces denied consent on every document. Keep
  legacy startup case separate or deliberately extend fixture ownership later;
  do not rely on ordering between competing init scripts.

### Vitals, exceptions and consent lifecycle

- Serve actual installed extension JavaScript locally. Existing blanket `{}`
  ingest fulfillment is unsuitable for proving native extension loading.
- Trigger genuine native browser error, then genuine vitals flush/navigation.
  Assert scrubbed `$exception` and `$web_vitals` arrive with anonymous identity;
  do not call fabricated direct capture as substitute.
- Deny consent, drain prior requests, then assert no new collection during real
  navigation/error. Regrant and assert correctly reseeded anonymous identity.
- Retain existing DNT, revision-race and consent-denial checks. Add storage-blocked
  case for canonical in-memory identity if repair changes this seam.

`__tests__/posthogPerson.test.ts` currently asserts UUID identify using fake
client; `posthogPageviews.test.ts` records fake capture arguments; direct
sanitizer tests never exercise SDK enrichment/flag requests. Those are useful
unit seams, not substitutes for above actual lifecycle proof.

## Evidence limits

This receipt contains source findings and conditional proposal only. No current
browser RED/GREEN, SDK fixture execution, production analytics delivery, build or
gate result is claimed. Root retains exclusive browser/performance runtime token;
friends owns any later approved identity repair.
