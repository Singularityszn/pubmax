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
