// The MapLibre 6 worker pair, named once.
//
// MapLibre 6 is ESM-only and its worker is a module that STATICALLY IMPORTS a
// sibling shared module. Nothing in the document named either URL, so a cold
// `/map` could not discover the 478 KB shared module until the whole chain had
// run: the map chunk downloads, parses and executes, PubMapCanvas calls
// setWorkerUrl, the worker module is fetched, and only then is the shared
// module asked for (perf/AGENTS.md, "THE ENGINE WAS NOT THE GATE").
//
// NAMING IS NOT WARMING. Fetching the pair early was built, measured and
// REVERTED (9b6dbcd8c, reverted by c52bb928b): it moved the shared module from
// 8,385 ms requested to 1,168 ms and the first tappable pin did not move
// (14,565 ms against 14,615 ms), and __tests__/mapEarlyWarm.test.ts forbids
// map-first-paint-init.js fetching anything before `pubmax:first-pins` because
// bytes pulled early compete with the work they are meant to accelerate. So the
// document STATES the two URLs and fetches neither: a `<meta>` costs no
// request, the pair is discoverable by a reader and by a profiler, and the next
// A/B has one place to change rather than a string inside the map chunk.
//
// Both files are copied into public/vendor/maplibre by
// scripts/copy_maplibre_worker.mjs (npm run prepare:maplibre-worker), which
// runs before dev and before every build.

/** The worker module MapLibre is told to spawn. */
export const MAPLIBRE_WORKER_URL = "/vendor/maplibre/maplibre-gl-worker.mjs";

/** The sibling the worker module statically imports, and nothing else names. */
export const MAPLIBRE_WORKER_SHARED_URL = "/vendor/maplibre/maplibre-gl-shared.mjs";

/** The meta name the document states the worker module under. */
export const MAPLIBRE_WORKER_META = "pubmax:maplibre-worker";

/** The meta name the document states the shared module under. */
export const MAPLIBRE_WORKER_SHARED_META = "pubmax:maplibre-worker-shared";
