# Map location and caching audit, 29 September 2026

Base commit: `76de20674da64604af22872ff42ee08fca7f156a`.
Branch: `codex/maps-location-20260929`.

## Changes with direct evidence

The remembered opening location had no timestamp. An old location could survive
indefinitely, then centre the map and warm venue cells near a place the reader had
left. The opening-location read also called `getCurrentPosition` when the
Permissions API was missing, threw, or returned an unknown state. That browser
call can trigger a permission prompt during mount.

Remembered coordinates now expire after 30 minutes. This is a product freshness
choice, not a claim about GPS accuracy. It retains a hint during a quick return
to the map while refusing yesterday's whereabouts. Readers remove undated,
expired, future-dated, negative or non-finite timestamps, malformed JSON and
invalid coordinates on their next read. No timer keeps the page alive to remove
them. An unused key can remain on the device until the next read.

The London boot script uses the same freshness boundary. It retains a fresh
other-city fix when it chooses London cells for its own warmup. Returned map
location values contain only latitude and longitude, not the storage timestamp.

Automatic current-location reads now require a confirmed `granted` permission
state. Missing, failed or malformed permission queries return immediately.
Existing explicit location buttons continue to request permission.

The remembered `near-me` mode also reached `PubMap.runNearMe("resume")` directly
after the venue index loaded. That path now queries the same permission reader
and requests coordinates only after a confirmed grant. Missing permission
support, denial and prompt states keep the saved view. A gesture during the
permission query or position request cancels the automatic result.
Each mounted city's Near me owner now aborts on city change or unmount. A late
permission answer cannot start its native request; a late native fix cannot
reach storage, reader-watch or camera side effects. Mode and gesture intent are
also checked again before applying a returned fix.

`location-replay.mjs` strips TypeScript with Node's built-in loader and runs the
actual location leaf plus the actual classic boot script. Its fake browser APIs
isolate stored-location selection and permission-call behaviour. It measures no
browser rendering speed and proves no real permission prompt or grant.

```sh
node docs/proof/maps-audit-20260929/location-replay.mjs 76de20674da64604af22872ff42ee08fca7f156a
node docs/proof/maps-audit-20260929/location-replay.mjs
```

Before: seven failed checks and one passing Manchester-preservation check,
exit 1. After: all eight checks pass, exit 0. JSON outputs are adjacent.
Focused Vitest regression cases cover the 30-minute boundary and permission
fallbacks. The initial four-file patch passed 27 tests across two files and
focused ESLint on 29 September using borrowed main-checkout dependencies,
Vitest 5.0.1 and Next.js 16.3.6. The permission-reader and resume-priority
follow-up then passed 183 tests across seven suites after a fresh isolated
`npm ci`, with the same dependency versions. Removing the viewport's live-owner
guard made its regression fail; restoring it returned all seven suites to green.
Raw tool outputs are copied to `focused-tests.log`, `viewport-before.log` and
`lint.log`; `validation.json` records their exit codes and limits. The three
logs are ignored by the repo's `*.log` rule and stay local. The JSON is an
reviewed working receipt. Staging names the receipts, reproducible scripts and
completed browser screenshots explicitly; raw runtime logs and partial progress
outputs are not force-added.

The first committed-data `npm run verify:no-mistakes` run exited 1: 1,694 files
and 17,985 tests passed, one file and five tests skipped, and one source fence
failed. It expected two opening-location cancellation callers; the approved
resume seam adds a third. The fence now names that intentional count. Before
the lifecycle fix, two deferred permission/native-position regressions failed.
After abort-aware reads and owner cleanup, eight suites passed 194 tests;
changed-path ESLint exited 0 with no errors and two warnings, and whole-app
TypeScript exited 0. Actual redirected outputs remain in ignored
`full-verify.log` and `resume-lifecycle-*.log`. At that stage, a fresh full gate,
production build and native browser proof remained outstanding. No build or
browser ran on the known-racy candidate.

An additional caller-specific regression executed the actual ordinary opening
effect callback, found via TypeScript AST, against the real location reader and
a deferred permission query. Disposing its owner then releasing a grant still
started one native request before the fix. An effect-owned AbortController now
prevents that request. Eight focused suites passed 195 tests after the fix;
changed-path lint and whole-app TypeScript both exited 0.

Fresh `npm run verify:no-mistakes` then exited 0: 1,695 files and 17,989 coverage
tests passed, with one file and five tests skipped. RLS passed 421 tests and
each shared-memory run passed nine. Whole-repo lint reported zero errors and
74 warnings; freshness retained one advisory stale dataset and three
unmeasurable durable feeds. Audit reported no high or critical vulnerabilities.

The first production build compiled but its restoration wrapper exited 1:
the command omitted `PUBMAX_TRACKED_OUTPUTS=public/data`, leaving generated
shard changes. Those owned generated changes were restored. The corrected
command in `validation.json`, using `.next-prod`, explicit tracked-data
restoration and deployment version `local`, exited 0. Tracked generated data
and Next environment files are unchanged.

The first native Chromium run reached tappable pins but timed out awaiting the
granted fix and reader-dot source. Its CDP permission override omitted the
isolated browser context ID, which the installed protocol explicitly requires
to target an incognito context. The driver now binds that ID and asserts the
page's actual permission state before location checks. A bounded diagnostic
run was canceled at the runtime deadline before producing a snapshot. The
private server and browser were stopped. This failed harness attempt supplies
no product-cause claim. All failed, canceled and passing command logs remain
local and ignored.

The corrected driver then passed all three states against the existing passed
production build at `http://localhost:3293`, with a 110-second global limit.
It asserted the page's actual Permissions API state before counting each case.
Granted permission made two native position requests and one native watch,
stored a fresh fix, rendered the blue dot and moved the camera to
`[-0.09, 51.515]`; eight map marks were tappable. Denied and prompt each made
zero automatic position requests or watches, removed the expired fix, retained
the six-day-old viewport and kept seven marks tappable. An explicit Near me
tap under denied permission made one native request and showed the refusal
message while those seven marks remained. All uncaught browser-error lists
were empty. Four screenshots were inspected. The driver exited 0, and owned
browser and server processes were stopped by 00:49:37 UTC on 30 September,
before the 00:52:10 runtime deadline.

CDP controls permission states and a simulated GPS fix. The harness seeds
remembered mode, old viewport and real public venue rows; native-call counters
forward to Chromium's original methods. App location callbacks, storage,
reader-dot source and rendered point, camera, painted marks and denial UI run
through the actual production page. This proves browser behavior with
controlled location inputs, not physical-device GPS or manual permission UI.
Completed readings are in `location-browser.json`; screenshots are
`location-granted.png`, `location-denied.png`, `location-prompt.png` and
`location-denied-tap.png`. Reproduce with the private production server running:

```sh
node --import tsx docs/proof/maps-audit-20260929/location-browser.mjs http://localhost:3293 --timeout-ms=110000
```

Focused ESLint exited 0 with no errors and two warnings. On the same installed
dependencies, the HEAD baseline also reports two warnings: the unchanged
`trimmedMapQuery` dependency warning, plus the component's complexity warning.
Its complexity moved from 51 to 54. Final application gate, production build and
corrected native three-state browser proof passed. An indentation-only change
to the accepted-location callback followed the build; application behavior was
unchanged for the browser replay.

## Current map behaviour

The map already has location-first entry. `lib/pubMap.ts` allows automatic
opening-location resolution only when a clean arrival has neither a resume
snapshot nor a restored mobile viewport. `lib/mapResume.ts` accepts viewport
snapshots up to 14 days old. Those saved views still own ordinary returns.

A remembered Near me now has one exception. On a clean arrival, its confirmed
live location may replace the saved viewport. Explicit URLs, named places,
planner continuation and gestures preserve their own camera intent. Once that
live fix owns the camera, asynchronous resume reads cannot restore the old view.
This changes no viewport retention period and adds no cache layer.

Ordinary opening-location requests use a two-second timeout, one-minute browser
position cache and low accuracy. Remembered and explicit Near me use the same
seven-second timeout.
The reader's blue dot uses its own in-memory location watch. The current fix
does not change or persist that watch.

Existing caching includes versioned manifest and shard requests, in-flight
deduplication, early JSON reuse, browser and CDN asset caching, service-worker
data caching, and IndexedDB fallback. The loader retries rejected deployment
revisions using `no-store`; that is freshness recovery rather than its normal
read strategy. Static assets with fixed filenames must retain invalidation.
Extending their browser cache blindly risks stale prices or incompatible packs.

## Performance changes need a new baseline

The location proof used an isolated production build and private local server.
Its corrected native browser run passed as described above. No cold/warm speed
A/B or timing sweep ran in this audit. Another chat owns host performance
measurements.

Existing repo proof already tested eager worker-file warming. The recorded
first tappable pin did not improve, and that change was reverted. The rule in
`docs/rules/perf-budgets-and-measured-findings.md` forbids eager warm before first
pins without an A/B showing a pin improvement. Existing first-pin stream holds
already delay shard rings, UK-base rows and ambient POIs until pins paint.
Those historical figures are not a current speed measurement.

Next useful measurements are cold and warm `/map` visits with matching production
build, viewport, CPU throttle, network settings and browser interception. Record
map construction, scene build, source readiness, visible pins and first tappable
pin. Include the actual camera owner and loaded cell count. A cached remembered
view and a fresh nearby view can need different cells and are different cases.

Official MapLibre guidance supports small payloads, visible-area streaming,
clustering and vector tiles for larger datasets. This app already streams
spatial venue cells. Worker prewarm retains resources between map instances;
it offers a candidate for repeated-map navigation, not evidence of a faster
cold visit. Increasing tile-cache size trades memory for reuse and must be
measured on phones. Preserve the repo's symbol-collision and density contracts.

## Friend locations

`/api/presence` publishes deliberate venue check-ins with a two-hour lifetime.
The route and DTO carry venue IDs and timestamps, not GPS coordinates. Reads
are public and the feed prints recent check-ins. The map inspector owns the
check-in tap. This is not a friend-only live-location feature.

`lib/crewFriendEdges.ts` creates mutual follows for committed signed-in crew
members. `lib/crewRealtime.ts` subscribes to payload-free plan signals and reads
the plan again through its existing gate. Neither shares live coordinates.
Friend locations need a separate consented, audience-gated contract. The root
agent owns that design.

## Scope boundaries

Open PRs 1870, 1871 and 1874 edit `PubMap`; PR 1872 edits `slimShards` and map
search; PR 1876 edits service-worker caching. The active v0 checkout also has
canvas, shell, loading, map navigation and browser-test work. These are the
overlap findings from the initial scope audit, not a current PR inventory.

The final source diff changes `lib/mapOpeningLocation.ts`, the classic warming
script, `lib/pubMap.ts`, the opening/resume seam in `components/PubMap.tsx`, and
their three focused unit files, plus the existing first-useful-pins caller-count
fence. This proof directory records the evidence.
The root coordinator approved the isolated PubMap/libpubMap follow-up after
the v0 owner confirmed opening/resume GPS ownership. Root will review the final
diff with v0 before integration. This branch has not edited the v0 checkout or
the canvas file. No push, merge, deployment or migration ran.

## Primary sources

- [MapLibre prewarm](https://maplibre.org/maplibre-gl-js/docs/API/functions/prewarm/)
  explains resource reuse between map instances.
- [MapLibre worker count](https://maplibre.org/maplibre-gl-js/docs/API/functions/setWorkerCount/)
  documents current defaults and the need to configure before map creation.
- [MapLibre tile cache options](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapOptions/)
  documents viewport-derived cache sizing.
- [MapLibre large-data guide](https://maplibre.org/maplibre-gl-js/docs/guides/large-data/)
  covers payload reduction, streaming and tiling.
- [Browser geolocation](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition)
  explains prompts, cache age, timeout and accuracy tradeoffs.
- [Permissions API](https://developer.mozilla.org/en-US/docs/Web/API/Permissions_API)
  explains permission state queries.

Installed Next.js guides were first read from the main checkout while this
worktree had no dependencies. The branch now has its own fresh lockfile install,
with Next.js 16.3.6 and Vitest 5.0.1. The script and lazy-loading guides describe
client-side import boundaries and script scheduling. No framework upgrade or
Next.js cache setting changed.
