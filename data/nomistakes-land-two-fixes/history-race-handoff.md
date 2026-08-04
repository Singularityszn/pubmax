# Desktop drawer history handoff

Status: next-lane input, intentionally not fixed in `nomistakes-land-two-fixes`.

## Ownership conflict

Desktop drawer mutual exclusion is synchronous at `components/PubMap.tsx:974-993` and `components/PubMap.tsx:1562-1589`: opening the planner clears venue selection, while opening a venue closes the planner. Loaded-route activation uses the same direct ownership calls at `components/PubMap.tsx:1699-1708`; it has no pending selection or reconcile-after-transition effect. Browser history remains split between two independent owners.

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

The retained regression at `e2e/desktop-map-chrome-fit.spec.ts:168-310` proves ordinary planner-to-venue ownership and composed-state restoration. It does not start from a root venue, queue selection-history release, or issue concurrent browser Back.

The retained regression at `e2e/desktop-map-chrome-fit.spec.ts:312-337` proves only synchronous venue-to-planner ownership: one drawer is open immediately after Plan tonight. It does not wait for or coordinate any browser-history traversal.

The loaded-route regression at `e2e/desktop-map-chrome-fit.spec.ts:339-416` now proves only that loading a route reaches the venue as one synchronous ownership batch, without a transient planner-open mutation. The previous loaded-route Back-restoration assertion was removed because it depended on the deferred planner-to-venue trail negotiation that this branch deliberately descoped. The replacement never presses Back, never establishes a predecessor, and cannot detect either concurrent history race quoted above.

## Requirements for a correct next-lane design

- One boundary must own both venue selection sentinels and surface depth entries.
- Drawer transitions, Back, Forward, Home, and URL selection changes must enter one serialized transition model.
- A pending traversal must block or incorporate another Back without fixed delays, animation timings, `setTimeout`, or one-pop guesses.
- Visible surface, selected venue, surface trail, URL, and stamped history depth must agree before a transition reports settlement.
- Restored planner entries must retain exact loaded-route and half-composed input state.
- Tests must start from a real predecessor, exercise immediate concurrent Back, cover settled planner Back, and assert semantic state rather than elapsed time.
- Existing phone behavior, direct synchronous desktop mutual exclusion, and Home behavior must remain unchanged.

This branch intentionally ships only direct synchronous drawer ownership. Loaded-route planner restoration and concurrent Back coordination are deferred to the single-owner history design described here.
