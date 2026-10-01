# Night-signals cache regression source review

Reviewed Luna's revised READY additions to `__tests__/nightSignalFeedApproved.test.ts` without executing tests or changing product source. Reviewed test SHA-256 is `3c0ff73951e4afa205ba61cbe0e1671a55e4bf27f250555955916e601cd37aca`. New checks remain UNRUN. No CDN replay or hosted stale-delivery result is claimed.

## Regression setup is supported

The `beforeEach` additions at line 73 stub `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` empty, clear `VERCEL_ENV`, and set `PUBMAX_E2E_KEYLESS=1`. They do not read or print environment values. `lib/supabase.ts:56` resolves configuration on each backend selection. Its keyless escape follows the production refusal at lines 60-88. `lib/storeBackend.ts:33` therefore selects the actual process-memory implementation for this fixture. The route-store mock delegates to that actual getter while `storeOverride.candidates` and `.durable` are null. Existing `afterEach` restores environment stubs and timers.

The expiry case at line 168 uses the existing fixed `NOW`, observation one day earlier, review one minute earlier, and expiry one minute later. Those times satisfy live-approved admission. The first real handler response must contain the unique claim ID. At exactly `expiresAt`, the second real handler response must omit it because admission requires `expiresAt > now`. Both responses require a `no-store` header. The ID's date-like text is not parsed as an observation date by the validator.

The approval case at line 185 saves an actual pending claim in memory. Its first real handler response must omit the ID. It then calls the real store's operations review at `NOW`, checks the decided approved result, and requires the second handler response to contain the ID. Observation precedes review and expiry remains in the future. No response body, approval result, or cache backend is fabricated by these additions. Push dispatch remains mocked by the existing suite, so these checks do not prove push delivery.

The new assertions express the response contract. They do not simulate a CDN, hold a fake stale response, or claim an actual cache hit. The revised order verifies both real response-body transitions before checking either cache header. Each header must equal `no-store`. On current product source, the first header assertion in each case is expected to fail only after the admission transition checks complete. That expected RED remains source inference until the owner runs it.

## No-store has a concrete reason

The keyless route reads mutable process-memory approvals as well as time-filtered snapshot claims. `app/api/night-signals/route.ts:40` reads reviewed candidates with `Date.now()`. Memory approval changes eligibility without a deployment at `lib/nightSignalStore.server.ts:291` and line 298. The response is therefore outside `jsonCached`'s pure request-and-deployment contract at `lib/apiResponses.ts:12`.

For an immutable snapshot alone, an expiry-aware TTL could prevent serving a claim beyond its next admission boundary. That would not solve a newly approved memory candidate while a cached earlier answer remains valid. The existing route has no approval-driven shared-cache invalidation. `no-store` is the smallest supported response policy for both actual inputs and already matches the durable-configured branch. The tests do not establish that every conceivable invalidation design is impossible, nor do they require one.

## One GREEN-phase expectation must change

The existing test at line 157 still expects keyless `s-maxage=300` and describes that answer as deployment-pure. It intentionally remains unchanged for the initial RED run. Once the owner changes the production response policy, that expectation and comment must be updated to the actual mutable-and-clock-bound contract. Keeping both assertions permanently would make the suite contradictory. The durable `no-store` assertion should remain.

No blocking fixture or clock defect found. The owner still needs the intended focused RED, minimal production correction, and focused GREEN. Actual CDN behavior and external consumers remain outside this source review.
