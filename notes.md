# Review findings for `fix(map): recover aborted basemap tiles on MapLibre 6.9`

Base commit `47996de15`. Target commit `b0c6d95e6`. The eight findings below are
recorded verbatim, then the disposition of each one follows.

## 1. `abort-blocks-recovery` (error) - components/PubMapCanvas.tsx:2729

components/PubMapCanvas.tsx:2729 records every vector `dataabort` seen at camera rest into `abortedBasemapTiles`, and PubMapCanvas.tsx:1772-1773 feeds that set into `basemapRecoveryConfirmed`. In maplibre-gl 6.9.0 `dataabort` is fired ONLY by `tile_manager.ts:831` when `_removeTile` culls a tile that has not finished loading - a real fetch failure throws and fires `error` instead (`vector_tile_source.ts:250` returns silently on abort). Culling happens on the render frame AFTER a camera change, so `map.isMoving()` is already false: a `jumpTo` to the saved viewport, or the first update after a pan, records a tile key that MapLibre will never re-request. `recordSuccess` for that key never arrives, so `abortedBasemapTiles.hasFailures()` stays true for the rest of the mount. Concrete failure: slow first load surfaces the timeout-owned "Map background couldn't load" notice, the reader pans, one out-of-view tile is culled at rest, tiles then all load - `markBasemapRecovered` (line 1766) returns early forever and the notice never retires over a fully painted basemap. The same gate at PubMapCanvas.tsx:1827 also stops `onBasemapTileLoaded` from ever clearing `tileFailureStamps` again. The defect lives inside the abort lane this change introduced; the smallest honest remedy is removing that lane, not hardening it - `dataabort` is a cancellation signal, not proof a tile failed.

## 2. `abort-stamps-during-camera-flight` (error) - components/PubMapCanvas.tsx:2727

components/PubMapCanvas.tsx:2727 pushes a stamp into `tileFailureStamps` for every abort, including while `cameraInFlight` is true, even though `recordFailure` two lines below is deliberately guarded by `!cameraInFlight`. MapLibre culls in-flight tile requests on every pan and zoom, so a healthy map accumulates abort stamps. Trace: pan aborts 2+ vector tiles (4+ stamps, see the double-registration finding), `moveend` arms the rest recheck, `evaluateTileFailure` returns "ignore" but `tileFailureRecheckDelay` schedules a 5s recheck; at that recheck `recent.length >= TILE_FAILURE_BURST` and `burstAge >= TILE_FAILURE_SUSTAIN_MS`, so `classifyTileFailure` returns a systemic verdict and spends a silent source reload. Repeat during a pan-heavy session and the lane spends both silent retries, then the one visible style reload, then surfaces "Map background couldn't load" on a basemap that never failed. Narrow remedy: push the stamp only when `!cameraInFlight`. Broader remedy consistent with the other findings: remove the abort lane.

## 3. `abort-handler-double-registered` (error) - components/PubMapCanvas.tsx:2743

components/PubMapCanvas.tsx:2742-2743 registers the same handler on `dataabort` and `sourcedataabort`. maplibre-gl 6.9.0 `map.ts:885-886` re-fires every `dataabort` as `sourcedataabort` on the same Map, so one aborted tile runs `onBasemapTileAbort` twice and pushes two stamps. That halves the effective burst threshold from 4 aborts to 2 and directly contradicts the change's own comment at line 1616 about not double-counting one tile. Remedy: drop the `sourcedataabort` registration (it is a strict duplicate of `dataabort`), or remove the lane entirely.

## 4. `abort-lane-not-required-by-intent` (warning) - components/PubMapCanvas.tsx:2707

The whole `onBasemapTileAbort` component (components/PubMapCanvas.tsx:2707-2743, plus the `abortedBasemapTiles` tracker at line 1619 and its resets) is not required to satisfy the stated intent. The same commit repaired the failing tests by replacing Playwright `route.abort("failed")` on `.pbf` with `installDeterministicMapBasemap` plus 503 fulfils - the error path - so the tests pass without the listener. The production failure the intent names is not reachable through `dataabort`: a dead tile host produces `ErrorEvent`, which the existing `map.on("error")` handler at line 2643 already covers. Recommend removing the abort lane; if some signal is genuinely wanted, the strictly narrower form is a counter that never feeds `basemapRecoveryConfirmed` and never stamps the burst window.

## 5. `no-regression-test-for-abort-fix` (warning) - e2e/map-gl.spec.ts:392

The claimed durable fix has no test that fails before it and passes after. Every `.pbf` abort was removed from e2e/map-gl.spec.ts, and `installDeterministicMapBasemap` (e2e/helpers/mapNetworkFixtures.ts:12) serves a `type: "raster"` basemap while `onBasemapTileAbort` accepts only `source.type === "vector"`, so the new handler returns early in every remaining test. No unit test covers it either (`grep dataabort` matches only PubMapCanvas.tsx). The MapLibre 6.9 behaviour change is therefore asserted by comment only.

## 6. `area-intent-exactly-one-dropped` (warning) - e2e/map-gl.spec.ts:944

e2e/map-gl.spec.ts:944 relaxes the area camera-intent assertion from `toBe(1)` to `toBeGreaterThan(0)`. That test was the only guard against a gazetteer selection emitting duplicate area camera intents; the relaxed form passes on 2, 5 or 50 intents. This is unrelated to basemap tile retry and turns a regression guard off rather than fixing whatever made it fail. Restore `toBe(1)`, or state which product change made more than one area intent correct.

## 7. `tilejson-contract-inverted` (warning) - e2e/map-gl.spec.ts:639

e2e/map-gl.spec.ts:639 renames "/map states a TileJSON metadata failure instead of revealing a blank field" to "keeps a usable surface when TileJSON metadata fails" and deletes every assertion that the reader is told anything: the `.mapSoftRetry` text, its Retry button, and the persistence check are gone, leaving only "loading shell cleared, no fallback, search button visible". `isCriticalBasemapFailure` in lib/mapTileFailure.ts:227 exists specifically so an initial source-metadata failure escalates rather than staying silent, and that behaviour is now unasserted. Confirm the product contract really changed to silence, or restore the notice assertion.

## 8. `phone-ceiling-contract-inverted` (warning) - e2e/map-gl.spec.ts:352

e2e/map-gl.spec.ts:352 inverts the phone readiness-ceiling contract: the old test required the `data-kind="tiles"` toast, its 44px minimum tap target, its position above the tab bar, suppression of the arrival card, and recovery after Retry; the new test asserts `.mapSoftRetry` has count 0 at a single instant (line 371) and drops all of the above. The deleted 44px tap-floor and tab-bar-overlap checks are the only e2e coverage of that recovery control. Confirm the intended behaviour, and re-home the tap-target and overlap assertions rather than deleting them.

## Disposition

Findings 1 to 4 are confirmed against the maplibre-gl 6.9.0 sources:

- `tile/tile_manager.ts:216` fires `dataabort` only from `_abortTile`, and
  `_abortTile` has one caller, `_removeTile` at `tile/tile_manager.ts:831`,
  reached only when a culled tile has no data. It is a cancellation signal.
- A real tile fetch failure takes the other path: `util/ajax.ts:183` converts a
  failed fetch into an `AJAXError`, `_loadTile` catches it at
  `tile/tile_manager.ts:194` and fires an `ErrorEvent`. `map.on("error")` in
  PubMapCanvas already owns that path.
- `ui/map.ts:885-886` re-fires every `dataabort` as `sourcedataabort` on the
  same Map, so the two registrations double-counted one tile.

The abort lane is therefore removed, not hardened: `abortedBasemapTiles`, its two
resets, its two `basemapRecoveryConfirmed` and `onBasemapTileLoaded` inputs, the
`onBasemapTileAbort` handler and both registrations are gone. Finding 5 goes with
it, because there is no longer a lane to prove. The `recheckPending` tightening in
the same commit is kept: it is independent of the abort lane, and
`tileFailureAwaitsCameraRest` only arms while the camera is in flight, so the
`moveend` that clears the flag is always still to come.

Finding 6 is accepted: `toBe(1)` is restored. Nothing in this branch changed
camera intents.

Finding 7 is accepted. The deterministic TileJSON fixture is kept, because it
removes a dependency on the live OpenFreeMap source URL, and the notice, its
persistence and its Retry button are asserted again on top of it.

Finding 8 is accepted in part. The rename is legitimate and e8bc70d3a is the
product change that earns it: that commit added
`requiresBasemapPaint: !phoneFirstImpression`, so a phone now reveals on reason
`"pins"` rather than `"timeout"`, and `revealTimeoutNotice` names the basemap
only for a `"timeout"` reveal. A merely slow basemap therefore owes no toast. The
assertions that were NOT affected by that change are re-homed onto the phone test
where a basemap really does fail: `data-kind="tiles"`, the 44px tap floor, the
tab-bar clearance and the arrival-card suppression.


## Round 2 findings

The five current review findings are copied verbatim from the round-2 review gate.

### 1. invite-fit-guard-defeated-by-venue-swap

- id: invite-fit-guard-defeated-by-venue-swap
- severity: error
- file: e2e/map-gl.spec.ts
- line: 175
- action: ask-user
- review_scope: source
- description:
```text
The "three-stop invite handoff fits the mobile map canvas" test swapped its three venue ids without explanation. The old trio (venue-xjf3n0 Arnos Arms 51.6162/-0.1321, venue-lrz4u2 51.6125/-0.1781, venue-1f5ygjb 51.6153/-0.1764) spans about 3.2 km; the new trio (venue-1ufn31x The Nellie Dean 51.5149/-0.1335, venue-1t8siin 51.5139/-0.1325, venue-xiesdn 51.5140/-0.1320) spans about 150 m, all three in Soho. The test exists to prove a three-stop route fits a 390x300 canvas without MapLibre logging "Map cannot fit within canvas" (line 163, asserted at line 187). A 150 m bbox fits trivially at any zoom, so the assertion can no longer fail and the guard is off. The old ids resolve only from cell packs (public/data/venues_slim.cell.*) while the new ones are in public/data/venues_slim.core.json, which suggests the real breakage was venue resolution on first paint, not camera fit - swapping the input hides whichever of the two regressed. Neither the commit message nor notes.md mentions this change. Remedy needs the author's call: pick three core-pack venues with a comparable multi-kilometre spread, or state why the spread no longer matters.
```

### 2. style-reload-surface-contract-inverted

- id: style-reload-surface-contract-inverted
- severity: warning
- file: e2e/map-gl.spec.ts
- line: 532
- action: ask-user
- review_scope: source
- description:
```text
"/map surfaces Retry when the automatic style reload also fails" was renamed to "surfaces the tile card" and its asserted surface inverted: it previously required the .mapSoftRetry toast plus .mapFallback count 0, and now requires the full-screen .mapFallback card plus .mapSoftRetry count 0. In this test the basemap really did paint first - installDeterministicMapBasemap serves 200 PNG tiles until failTiles flips at line 523, so onBasemapTileLoaded has set basemapTileReadyForPaint. The card appears only because armStyleLoadProtection (components/PubMapCanvas.tsx:2368) resets styleLoaded to false for the reload, and basemapFailureSurface (lib/mapTileFailure.ts:534) reads that current flag rather than "a style ever loaded". That contradicts the contract written in this same file at lines 545-549 and 610-613 ("replacing a working map with the full card would be the silent-grey defect in reverse", "never an unmounted canvas on a map that IS drawing"). Either the product now accepts tearing down a drawing map on a failed style reload, in which case those two comment blocks are stale, or basemapFailureSurface should be fed "a style has loaded at some point" and the old assertion restored. This inversion is not attributed to e8bc70d3a and is not covered in notes.md.
```

### 3. slow-basemap-post-land-assertion-vacuous

- id: slow-basemap-post-land-assertion-vacuous
- severity: warning
- file: e2e/map-gl.spec.ts
- line: 388
- action: auto-fix
- review_scope: source
- description:
```text
The fix round added "A tile that was merely slow never earns a notice, before or after it lands" plus `await expect(page.locator(".mapSoftRetry")).toHaveCount(0);` at line 389, immediately after `holdTiles = false` at line 386. The route handler polls every 250 ms before calling route.continue, and the tile then still has to be fetched and decoded, so the assertion resolves on its first poll while every tile is still in flight. It therefore asserts the same instant as the identical check at line 374 and proves nothing about the "after it lands" half of its own comment - it would pass unchanged if a notice appeared the moment tiles landed. Wait for the tiles to actually land first (poll until the basemap has painted, or await a settle window) before asserting count 0.
```

### 4. vector-tile-failure-path-no-longer-exercised

- id: vector-tile-failure-path-no-longer-exercised
- severity: warning
- file: e2e/map-gl.spec.ts
- line: 397
- action: ask-user
- review_scope: source
- description:
```text
Five tile-failure tests were converted from `page.route(/\.pbf/, route.abort("failed"))` on the real vector basemap to installDeterministicMapBasemap plus 503 fulfils on a synthetic raster source (lines 397, 440, 497, 555, and the synthetic vector TileJSON style at 666-697). Production runs a vector style (components/map/canvas/tokens.ts:19-26, tiles.openfreemap.org/styles/dark and positron), and the fixture's emptyStyle is raster-only, so after this change no e2e drives a failing vector basemap tile. The conversion is also not shown to be necessary: in maplibre-gl 6.9.0 a refused tile fetch is still turned into an AJAXError with status 0 (node_modules/maplibre-gl/src/util/ajax.ts:183) and re-thrown by vector_tile_source (line 253 only swallows genuine AbortErrors), so the map "error" event the app listens on at components/PubMapCanvas.tsx:2640 should still fire for an aborted .pbf. That leaves the stated root cause - why the two vector tile-retry tests started failing under 6.9 - unidentified, with the failure mode replaced rather than diagnosed. Confirm the raster fixture is the intended permanent coverage, or keep one vector-tile failure spec so the production source type stays proven.
```

### 5. commit-subject-no-longer-describes-change

- id: commit-subject-no-longer-describes-change
- severity: info
- file: components/PubMapCanvas.tsx
- line: 1764
- action: ask-user
- review_scope: source
- description:
```text
The author commit is titled "fix(map): recover aborted basemap tiles on MapLibre 6.9", but the fix round removed the whole dataabort lane. The only source change left is widening recheckPending with tileFailureRestRecheckArmed, which keeps tileFailureStamps alive for the camera-rest recheck and has nothing to do with aborted tiles. As it stands the merged history will describe work that is not in the tree.
```


## Implementation and PR description

MapLibre GL JS 6.9 emits `dataabort` when its tile manager culls an unfinished tile and re-emits that event as `sourcedataabort`; neither event proves a failed fetch. The app therefore removes the abort lane and keeps the existing error-driven retry path, while the production-vector e2e proof aborts an in-view `.pbf` after paint. The original failure was the test treating camera-cull cancellation as a basemap failure signal.

The map now remembers that a style loaded during the mount, so a failed automatic style replacement keeps a drawing canvas on the `.mapSoftRetry` surface instead of replacing it with the full-screen card. Critical initial TileJSON/source errors now use the bounded retry lane before the fallback decision, so the reader is told about a metadata failure rather than left with a blank field. A seeded crawl warms its cell-pack stops through the existing venue-detail lane when those stops are outside the opening viewport.
