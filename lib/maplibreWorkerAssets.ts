// The MapLibre 6 worker module, named once.
//
// MapLibre 6 is ESM-only and its worker is a module that STATICALLY IMPORTS a
// sibling shared module (`maplibre-gl-shared.mjs`). Next's asset URL transform
// does not emit that sibling beside the worker, so both files are copied into
// public/vendor/maplibre by scripts/copy_maplibre_worker.mjs
// (npm run prepare:maplibre-worker), which runs before dev and before every
// build, and PubMapCanvas tells MapLibre to spawn the worker from here.
//
// The document never names the worker, and public/map-first-paint-init.js
// never fetches it. lib/mapEngineWarm.ts asks for it when the map shell mounts,
// which an interleaved A/B measured moving the pins.

/** The worker module MapLibre is told to spawn. */
export const MAPLIBRE_WORKER_URL = "/vendor/maplibre/maplibre-gl-worker.mjs";
