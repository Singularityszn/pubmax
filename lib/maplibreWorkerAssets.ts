// The MapLibre 6 worker module, named once.
//
// MapLibre 6 is ESM-only and its worker is a module that STATICALLY IMPORTS a
// sibling shared module (`maplibre-gl-shared.mjs`). Next's asset URL transform
// does not emit that sibling beside the worker, so both files are copied into
// public/vendor/maplibre by scripts/copy_maplibre_worker.mjs
// (npm run prepare:maplibre-worker), which runs before dev and before every
// build, and PubMapCanvas tells MapLibre to spawn the worker from here.
//
// NO DOCUMENT NAMES OR WARMS THE PAIR. Fetching it early was built, measured
// and REVERTED (9b6dbcd8c, reverted by c52bb928b): the first tappable pin did
// not move, and perf/AGENTS.md forbids a fetch before `pubmax:first-pins`.
// Naming it in a `<meta>` was measured too and bought no byte and no fetch
// (docs/proof/venue-price-updates-per-venue/).

/** The worker module MapLibre is told to spawn. */
export const MAPLIBRE_WORKER_URL = "/vendor/maplibre/maplibre-gl-worker.mjs";
