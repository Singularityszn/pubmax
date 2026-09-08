# Map recovery source proof

Base: `ad3af95996e7a7499a859951eabea16db6c707f4`.
Engine: installed `maplibre-gl@6.7.0`.

The initial tile repair is commit `2afb68eb818f7411bb235e4c600b134686699957`.
It tracks initial failures and requires a successful tile before accepting recovery.
The source retry API, two silent attempts, style retry budget, and failure thresholds stay unchanged.

`__tests__/mapTileRecoveryCaller.test.ts` executes the component's actual handlers and MapLibre's installed tile-readiness method.
Before the repair, an all-errored render cancelled the source retry and retired the timeout notice.
The red run had two failures and one pass.
The final cases cover initial failures, partial success, successful retries, and permanent failure escalation.

The context repair cancels old scene work when either context-loss event arrives.
It changes the scene generation and waits for the replacement style's `style.load` event.
`__tests__/mapContextRecoveryCaller.test.ts` executes the installed engine's loss, restoration, and deferred JSON-load methods.
It also executes the component's scene callback and context handlers.
Renderer, network, worker IO, and scene-body drawing are doubles. This is not a full React mount or GPU test.

The pending callback reproduced `Style is not done loading.` before the repair.
The component reported `The map loaded tiles but couldn't finish drawing pubs.`
The steady-state restore already passed. Both cases now pass.

The final focused run passed 62 tests across five files with `--maxWorkers=1`.
Scoped TypeScript validation reported zero diagnostics across all six changed TypeScript files and their imports.
ESLint reported zero errors and the existing `PubMapCanvas` complexity warning of 74.
Full logs remain in `/Users/karanmanoharan/Documents/projects/pubmaxx-map-recovery-proof/`.

The browser fixtures now count intercepted tile failures and successes.
Context fixtures use the deterministic basemap and distinguish pending-scene loss from steady-state loss.
They require a rebuilt scene as well as the restored marker.
These browser cases have not run. No build, browser, PostgreSQL, simulator, or full gate ran for this work.

Root owns the separate two-line GL-routing patch at `/tmp/pubmaxx-map-recovery-gl-routing.patch`.
It excludes these specs from default `chromium`; their existing `chromium-gl` project retains them.
That project provides SwiftShader and blocks service workers, which can bypass tile interception.
After root releases its window, run both browser specs with `--project=chromium-gl --workers=1` against the integrated build.
Do not treat the source tests as completed browser or native recovery proof.

## Deferred scene follow-up

Root ran seven GL cases against integrated commit `605249b97`.
Six passed, including transient tile recovery at both widths and all three context cases.
Permanent tile failure showed the Retry notice but failed the style-reload assertion.
Root retained `/tmp/pubmaxx-audit-recovery-gl.log` and `/tmp/pubmaxx-audit-recovery-gl.json`.

The source regression runs `style.load`, four tile errors, deferred scene completion, then the retry backoff.
Before this change, scene completion cleared the queued retry, although the style had not changed.
The red result was one failure and five passes in `deferred-tile-red.log`.
Generation reset now runs in the accepted `style.load` handler, before scene work yields.
The source retry can then spend its two attempts and the single style reload.
Separate cases retain successful tile readiness and cancel old retries when a replacement style loads.

The focused follow-up passed 58 tests across three files with one worker.
ESLint reported no errors and the existing complexity warning.
Logs are `deferred-tile-green.log` and `deferred-tile-lint.log` in the proof directory named above.
This reproduces a concrete source sequence; the retained browser failure has no event trace confirming that sequence.
Root must rerun the permanent-outage case against this follow-up. No browser or build ran here.

## Basemap deadline after early phone pins

The ad3 `map-gl.spec.ts:345` failure received `pins`, while the fixture expected `timeout`.
Its held tile requests also left no basemap notice in the saved snapshot.
An early reveal clears the coordinator's ceiling. Held requests emit no error for the tile classifier.

The caller regression runs the component's actual coordinator options and its real render listeners.
It reveals phone pins once at 500ms, holds the basemap, then advances to the existing 12-second ceiling.
The red run had one failure and eight passes: the expected notice was absent.
The component now retains a separate phone basemap deadline within its existing tile generation.
This timer uses the existing notice, yields to error and pin notices, and does not repeat the reveal.
Successful tiles, a replacement style, and teardown cancel it.

The focused run passed 89 tests across four files with one worker.
Cases cover late-success retirement, error ownership, style replacement, teardown, and the original reveal timeout without duplicate notices.
ESLint reported no errors and the existing complexity warning.
Logs are `phone-deadline-red.log`, `phone-deadline-green.log`, and `phone-deadline-lint.log` in the same proof directory.
No browser or native result is claimed for this deadline change.

## Deadline handoff after pin recovery

Parent review found a missing handoff in `9cf6e0b0a`.
An active pin notice suppressed the deadline at 12 seconds, then pin recovery cleared the notice without restoring the missing-basemap notice.
No existing caller guaranteed another notice.

The regression now executes the actual `markPinsRecovered` block and applies its functional notice updates.
The red run returned `null` after pin recovery: one failure and 14 passes.
The deadline now retains its expired state while a pin notice owns the surface.
Pin recovery publishes that overdue notice immediately, using the original deadline and existing notice priorities.
Successful tiles, style replacement, and teardown discard the expired state.

The final focused run passed 93 tests across four files with one worker.
ESLint reported no errors and the existing complexity warning.
Logs: `phone-deadline-handoff-{red,green,lint}.log` in the same proof directory.
No browser, build, PostgreSQL, or native runtime ran during the iOS baseline window.

## Pending browser acceptance

The original phone readiness case still clicks the actual Retry and retains its 44px and tab-bar clearance checks.
Tiles remain held until the existing construction mark proves that Retry replaced the map.
It then releases tiles, requires a new phone reveal, and waits beyond the replacement map's basemap deadline without a notice.
The former `timeout` and `tiles` reveal expectations now follow the actual phone pin behavior.

A separate case retains the same map while tiles are held.
It requires early pins, one basemap notice, release of held tiles, and automatic notice retirement.
Construction marks and reveal events must remain unchanged across that recovery.
Both cases release pending route handlers when the page closes.
The fixture passed ESLint and diff checks only. Neither case ran during the iOS baseline window.
