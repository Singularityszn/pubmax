# Desktop drawer history handoff

Status: next-lane input, intentionally not fixed in `nomistakes-land-two-fixes`.

## Ownership conflict

Desktop drawer mutual exclusion remains synchronous in `components/PubMap.tsx:978` and `components/PubMap.tsx:990`: opening the planner clears venue selection, while opening a venue closes the planner. Browser history remains split between two independent owners.

- `components/map/pubmap/useMapSelectionHistory.ts:55` owns the venue selection sentinel. Its close transition calls `window.history.back()` at `components/map/pubmap/useMapSelectionHistory.ts:134`, then reconciles the resulting `popstate` at `components/map/pubmap/useMapSelectionHistory.ts:156`.
- `lib/useSurfaceStack.ts:139` separately calls `window.history.back()` for surface Back. Its listener at `lib/useSurfaceStack.ts:162` derives trail depth from the entry that wins the traversal.
- `components/map/pubmap/useMapSurfaceTrail.ts:103` follows the visible surface and deliberately opens a venue without pushing a second history entry at `components/map/pubmap/useMapSurfaceTrail.ts:118`.

These owners can each issue or interpret a traversal without knowing whether the other owner has a pending move. Local pop holds and settlement callbacks cannot make two independently queued history deltas atomic.

## Review findings

### `early-back-overtakes-history-release`

Review location: `components/map/pubmap/useMapSelectionHistory.ts:96` before the asynchronous coordination was removed.

> Criterion "press Back at earliest possible moment before completion ... correct surface still wins" remains broken when Map has a real predecessor. `releaseSelection` queues one Back and the user queues another; each is an independent history delta, while `holdThroughNextHistoryPop` absorbs only the first pop. The second can leave Map or pop the newly written planner entry. Current regression never establishes a predecessor, so this path can pass accidentally. Serialize user Back at the selection-history owner and cover a prior-page arrival. See [HTML history traversal](https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-history-back).

### `settled-planner-back-loses-venue`

Review location: `components/PubMap.tsx:1005` before the asynchronous coordination was removed.

> Criterion "Back always resolves against settled state" also fails after a root venue-to-planner handoff settles. The venue sentinel is popped while line 1005 preserves `[venue]` in the surface stack; planner then pushes depth 2 over a clean depth-0 entry. Planner's rendered Back restores venue state and starts another asynchronous Back, but selection history pushes a venue sentinel before that pop and then dismisses venue when the pop lands on a non-sentinel entry. Reconcile retained parent depth at the shared selection/surface-history boundary, or deliberately make planner root and remove the impossible Back affordance.

## Why current regressions do not cover this

The removed early-Back regression navigated directly to `/map`, so it did not establish a real predecessor before queuing two Back operations. It could pass even when the second traversal would leave the Map in a real journey.

The retained regression at `e2e/desktop-map-chrome-fit.spec.ts:312` proves only synchronous venue-to-planner ownership: one drawer is open immediately after Plan tonight. The retained loaded-route regression at `e2e/desktop-map-chrome-fit.spec.ts:339` covers planner-to-venue Back restoration, not root venue-to-planner settlement followed by another Back. Neither test claims concurrent browser-history correctness.

## Requirements for a correct next-lane design

- One boundary must own both venue selection sentinels and surface depth entries.
- Drawer transitions, Back, Forward, Home, and URL selection changes must enter one serialized transition model.
- A pending traversal must block or incorporate another Back without fixed delays, animation timings, `setTimeout`, or one-pop guesses.
- Visible surface, selected venue, surface trail, URL, and stamped history depth must agree before a transition reports settlement.
- Restored planner entries must retain exact loaded-route and half-composed input state.
- Tests must start from a real predecessor, exercise immediate concurrent Back, cover settled planner Back, and assert semantic state rather than elapsed time.
- Existing phone behavior, direct synchronous desktop mutual exclusion, and Home behavior must remain unchanged.

This branch intentionally ships only direct synchronous drawer ownership. Concurrent Back coordination is deferred to the single-owner history design described here.
