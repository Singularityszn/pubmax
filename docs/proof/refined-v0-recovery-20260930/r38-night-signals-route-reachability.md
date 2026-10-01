# Night-signals public GET reachability

Source-only review in Core. No requests, tests, builds, database reads, or runtime consumer checks were executed. Comparison object is Main `f33f77e42`. Issue #1743's no-caller lead remains an adoption question, not proof that this endpoint is disposable.

## Contract and callers

`app/api/night-signals/route.ts`, `lib/nightSignalClaims.ts`, `lib/nightSignalStore.server.ts`, `lib/pushSender.ts`, and `__tests__/nightSignalFeedApproved.test.ts` have no worktree diff against that Main object. The endpoint behavior is inherited, not a new Core regression.

A search for `/api/night-signals` in `app`, `components`, `lib`, `scripts`, and `e2e` found no first-party HTTP consumer. The endpoint itself and direct route unit tests reference it. That search cannot establish whether an external client, monitor, or deployed caller uses the documented URL.

The public contract is explicit:

- `docs/CRON_PLANE_RUNBOOK.md:188` says an approved, in-window candidate joins this GET beside the committed snapshot.
- `docs/CAPACITOR_WRAP.md:278` names this GET as the active night-signal broadcast trigger for registered devices.
- `app/api/night-signals/route.ts:19` returns version, snapshot `asOf`, durable-read availability, and approved claims, with optional exact `entityId` filtering.
- `__tests__/nightSignalFeedApproved.test.ts:87` covers approved admission and pending/rejected exclusion. Lines 110, 125, 136, and 152 cover expiry, entity filtering, failed-store disclosure, and cache headers.
- `__tests__/pushEventHooks.test.ts:90` covers the non-blocking broadcast hook. These are direct handler tests, not evidence that a real client invokes the endpoint.

The producer and planning consumer are different paths. `scripts/refresh_night_signal_claims.mjs:116` writes the reviewed snapshot. `app/api/cron/refresh-night-signals/route.ts:13` describes pending candidate ingestion and explicitly forbids publication. Neither calls the public GET. `lib/planGeneration.server.ts:57` imports the snapshot directly and passes it to temporal evidence at line 326. `lib/planGenerationTemporalEvidence.ts:66` applies the same active-claim policy without an HTTP call. Removing the GET would not remove this planning dependency or retire the night-signal family.

`docs/plans/PlanAstra.md:399` proposes retirement only after D2 approval and expressly preserves the durable review pipeline. That proposal does not establish approval to delete this endpoint.

## Public disclosure boundary

The route exposes reviewed public claim provenance. It does not return a raw database row. `lib/nightSignalStore.server.ts:111` maps explicit fields through `validateNightSignalClaim`. The validator returns the claim schema at `lib/nightSignalClaims.ts:156`, excluding arbitrary row properties. The approved store read applies live-window admission at `lib/nightSignalStore.server.ts:240`; its durable query also filters approved state and observed/expiry time at line 407. Pending and rejected candidates do not enter the public response through these paths.

The response intentionally contains review authority, dates, source URLs, publisher, confidence, and corroborating sources. Those are declared public claim fields. This review found no account capability, private crew payload, or moderator credential in that projection. It does not prove every stored claim's prose or source URL is appropriate for publication.

The GET also starts a public broadcast for active snapshot claims at `app/api/night-signals/route.ts:29`. `lib/pushSender.ts:256` spends a snapshot-version claim before delivery; lines 274-284 avoid repeated sends. No first-party HTTP caller means actual deployment-triggered broadcast initiation remains unproved. Deleting the route would remove this documented trigger unless its owner provides a replacement or retires the behavior.

## Conditional cache correctness gap

The existing R19 finding still applies. `app/api/night-signals/route.ts:55` calls the non-durable answer a pure function of deployment and permits `s-maxage=300, stale-while-revalidate=600`. However, `activeNightSignalClaims` uses `Date.now()` at `lib/nightSignalClaims.ts:175` and excludes expired or not-yet-observed/reviewed claims. The non-durable candidate store is also mutable memory at `lib/nightSignalStore.server.ts:268`, read with a supplied current time at line 291.

That branch contradicts the pure-request-and-deployment requirement in `lib/apiResponses.ts:12`. A held response can retain a claim after its expiry or omit a newly eligible claim. An in-process approval can also change the response without a deployment. The durable-configured branch uses `no-store`, including when the durable read falls back or fails. Configuration selection is `nightSignalStoreIsDurable` at `lib/nightSignalStore.server.ts:611`.

This is a source contract mismatch in the non-durable branch, not a proved production CDN delivery or private-data leak. Existing tests encode the cached branch and check handler-time expiry; they do not replay an already cached response across an expiry or approval boundary.

## Bounded next evidence

Keep the endpoint until its owner reconciles the documented feed and broadcast contracts with actual deployed consumers. Source grep alone is insufficient removal evidence. A future runtime grant can inspect actual request usage and exercise the registered-device broadcast lifecycle without claiming that direct handler tests prove delivery.

For the cache lead, the smallest deterministic regression is a non-durable approved claim near expiry, followed by a read after expiry and a held-response replay. A separate memory approval boundary can test the deployment-purity assertion. Both proposed checks are UNRUN. They need no endpoint deletion, new cache framework, or budget change.
