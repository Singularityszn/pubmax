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
