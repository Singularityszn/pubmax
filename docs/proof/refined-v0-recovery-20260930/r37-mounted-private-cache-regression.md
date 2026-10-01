# R37 mounted private-card cleanup regression

Status: SOURCE PREPARED, UNRUN. No tests, lint, typecheck, build, browser, server, install, SQL, secrets or Git mutation. Production unchanged. Only `__tests__/profileWithdrawnPage.test.tsx` and this receipt changed for this task. Existing four profile-not-found tests and other lane changes preserved.

## Prepared contract

One new real ProfilePageClient mount case at `__tests__/profileWithdrawnPage.test.tsx:189` starts a private full-card read for canonical viewer A (`bob_bitter`) viewing a different target (`alice_pints`). A native Response wraps a demand-driven ReadableStream; `highWaterMark: 0` makes its pull marker represent body consumption, and fixture signal abortion errors that body. An explicit release can deliver its JSON only while its actual request signal remains live. This models native fetch's pending-body cancellation, using the established body fixture idiom from `authedFetch.test.ts`.

After consumption begins, the test invokes exported cache clear, changes mocked auth user/revision and canonical viewer to B (`charlie_lager`), then rerenders the same component with the same route params promise. React runs the actual effect cleanup; no internal ref is mutated. The test requires A's request signal to abort, releases its old pending source, and requires B's separate query/bearer request to complete.

Assertions cover exact distinct viewer keys and per-fixture bearer values, B's limited private-account notice, absence of A's private bio canary, absence of A's memory/session snapshot, and B's independent memory/persisted snapshot. The cache helper remains real. Polling is outside any async act scope waiting for DOM changes; a small act flush precedes each B-cache assertion. No sleeps or fixed number of microtasks establish body readiness.

## Evidence limit

Auth hooks, canonical handles, tokens and server projection responses are explicit fixtures. This does not verify live provider switching, actual bearer entitlement, database ownership, the device identity event's provider ordering, or already-decoded-body timing. A and B never share a canonical handle or private cache key. The old body has begun consumption but remains undecoded at the account change, so this is the normal rerender-cleanup safeguard identified in R37, not a fabricated reproduction of the unresolved interval.

Current source predicts this safeguard passes; no PASS, RED, leakage or causal closure is claimed before execution. Removing actual profile cleanup would leave the old request live and fail the abort requirement. Generic clear/in-flight invalidation remains independently covered by the seven prepared `surfaceReadDedupe` cases, not demonstrated fixed by this mount control.

## Next authorized check

From the owned Core checkout, after explicit runtime handoff:

```sh
npm test -- __tests__/profileWithdrawnPage.test.tsx __tests__/surfaceReadDedupe.test.ts
```

Report mounted safeguard and generic boundary findings separately. Any subsequent private interval claim still needs its own observed schedule and actual entitlement evidence; no production fix is justified solely by this prepared control.

## Follow-up: already-painted private links across viewer changes

SOURCE PREPARED, UNRUN. A second mounted case loads A's complete card first, including a supported Instagram `PublicSocialLink`, then switches to distinct canonical B while B's limited-card native Response body remains held. This is separate from the pending-A-body cancellation control above.

The API's contract is precise: `app/api/profiles/[handle]/route.ts:219-231` uses `projectionCarriesSocialLinks` to return links only on the full projection; `lib/profileVisibility.ts:169-174` treats them as private alongside the bio. **Follower/following counts are not withheld:** the same API includes `counts` on both lanes. The new fixture therefore keeps the same public counts (17/19) on both responses and checks their availability after B's limited answer, rather than inventing private-count policy.

Current source resets stored profile, projection and read state at `ProfilePageClient.tsx:469-492`, but leaves `socialLinks` and `counts` held. `visibleSocialData` at `:887` gates only follow booleans by `followStateReady`; enabled launch mode preserves links and counts. `ProfileHeader` receives links unconditionally at `:1462` and renders them through ProfileSocialLinks. No current viewer/projection gate withholds the previously held links while B's answer is pending. The source predicts the new link-absence assertion fails; this is **expected RED inference**, not an executed failure or a claim of live cross-account disclosure.

The case waits for A's link and snapshot, performs the real React rerender with changed mocked revision and canonical handle, then waits for B body consumption plus removal of A's bio. That last condition establishes the existing state reset has occurred; it does not wait for B's held answer. At that point A's link/username must already be absent. B's response is released only afterward, with finally cleanup on failure. Actual component/cache remain mounted; no internal refs, helper mock or artificial callback/write gap are used.

The fixture represents an entitled A and stranger B on a private third-party route, with Social enabled (current default) and distinct handles. It does not establish real server relationship, actual provider/cross-tab signaling or native screenshots. A cross-tab provider account update reaching this same mounted route would reuse the revision-dependent state path, but its delivery/timing still requires future native proof. Public counts retaining their value is not itself a privacy violation. Counts remain eligible on the limited answer; this case does not prescribe their temporary pending state or invent new entitlement policy.
