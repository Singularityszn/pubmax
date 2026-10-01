# R37 price-intent lifecycle regression import

## Source and compatibility

Imported `e2e/price-intent-lifecycle.spec.ts` byte-for-byte from `f33f77e42b8a045695529ec87f2ed1b6ed4cb719`. Its SHA-256 is `0ed9fb94edef304809a654d4afaa0df756e8b3c006d52eeb8d950e1911364d35`. The Core copy has the same hash.

Core provides the imported helpers. `installAuthDoubles(page)` remains callable with one argument; its newer optional `initialSeedOnly` setting does not affect this call. `seedSignedIn(page, "A")` and `installDeterministicMapBasemap(page)` also match. Existing `price-contribution-entry.spec.ts` covers Create entry and picker reset. `city-price-auth-return.spec.ts` covers a locally owned auth callback. Neither covers these four intent-retirement transitions.

## Cases retained

1. A selected, signed-in price intent clears on Home, and Create starts a new contribution.
2. An anonymous intent stays with the first selected pub. After Home, selecting another pub does not carry the old gate or intent.
3. An anonymous intent retires when another pub replaces the gated selection.
4. Back from a gated pub returns to the picker, permits another selection, and clears when Home closes it.

The spec retains its 90-second file timeout and all assertions. It sets a 390 by 844 viewport, reduced motion, and local onboarding and consent state. It blocks service workers and installs deterministic map basemap fixtures.

## Evidence boundary

The auth flows use `installAuthDoubles`; signed-in state comes from `seedSignedIn`. They do not contact a real auth provider or prove durable account writes. The basemap is controlled by a fixture.

Case 3 directly calls `window.next.router.push` to exercise a client selection change while the map stays mounted. It aborts the venue-detail request to control warming and reopening. This is controlled-router coverage, not proof that a native `Link` works.

Status: **UNRUN**. This import records regression source only. It does not establish Playwright, browser, provider, or release acceptance.
