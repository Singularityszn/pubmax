# R25 next diagnostic seams

Source-only review, no cause closure and no new runtime grant. Root source gate passed; full-five remains red.

The SW failure waits at `e2e/map-service-worker.spec.ts:264` before its activation timeout and before reload/reveal. Its controllerchange listener precedes register, ruling out ordinary listener-after-register ordering. A deferred canonical same-scope registration in `components/OfflineReady.tsx` may compete once the fixture removes its route. This occurrence is unproved. Target skipWaiting applies against legacy policy; a canonical active worker may instead leave target waiting. Install precache and activate migrations have no internal deadline.

Next native failing run must retain registration URL/time/settlement, candidate state changes including redundant, active/waiting/installing and controller URL, worker errors and pending shell/cache work. Capture outside the unresolved evaluation so timeout cannot erase the journal. Retain original takeover, installed, activated, poisoned-purge, continuity, offline and reveal assertions. A post-reload reveal baseline cannot explain this earlier failure.

Native zoom passed only schedules where opening intent preceded the first click. Next probe must establish and capture clicks before a late opening intent while preserving the original +2.5 settled zoom threshold. No blind waits, raised budgets or assertion weakening. WebGL focused recovery passed unchanged; reproduce startup context loss at the original readiness under the two-worker conditions and capture first-pin readiness/fallback transitions.

After a causal fix, run the original affected flows and whole five-project suite on one frozen fresh build. Earlier whole run took 24.5 minutes plus build and cleanup. Strict default-five CWV and route-resource sweeps require separate bounded time. Root now source-only until coordinator grants a slot.


## WebGL source lead, not native causal closure

The captured fallback text maps uniquely to the `buildScene` catch in `components/PubMapCanvas.tsx:2049`. Calling it a first-pin readiness timeout was imprecise. Installed MapLibre's `src/ui/map.ts:4238` context-loss handler destroys the painter, destroys the style and sets `map.style = null`, even for the synthetic DOM event. It runs before the app's later canvas listener. `PubMapCanvas` publishes listening before scene-built; the deferred scene executes under a generation and `styleStructureReadyRef` guard, but context-loss handling currently does not invalidate that readiness guard. This permits an early loss to leave pending scene assembly pointed at a removed style. Actual thrown error and timing were not captured, so this is a source-supported schedule, not confirmed cause.

The current test comment that synthetic loss leaves a healthy lab context does not imply MapLibre's style remains usable. Focused mounted-canvas passes do not prove repainted pubs after the synthetic event. Next failing run should capture the buildScene error message and timing relative to loss/style-load/scene-built. Separate real `WEBGL_lose_context` loss/restore from synthetic DOM dispatch, then verify rendered map/pins as well as mounted canvas. Preserve the original full-run failure and all existing expected controls. No speculative production or test edit was applied from this source review.


## Camera cancellation source audit

`PubMap.dismissAmbientBanners` synchronously records reader camera use, cancels opening resolution and clears opening focus. The focus-mint effect also checks the reader-touch ref. Thus a proposed diagnosis that the parent always leaves old opening focus active is false. A smaller pending-frame seam remains: `useMapCamera.scheduleCamera` defers a captured opening move and checks gesture state again, but opening-location is outside the reactive hold set. A completed zero-duration zoom has inactive gesture state before that deferred callback. The parent clearing a focus prop does not by itself dispose the coordinator's already captured callback. This schedule remains unobserved, and the R25 driver captured only opening-before-click runs. No reactive-set or gesture-policy change was made without native reproduction.
