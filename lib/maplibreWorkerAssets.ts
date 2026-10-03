// MapLibre 6 is ESM-only. The worker statically imports a sibling shared
// module (`maplibre-gl-shared.mjs`). Next's asset URL transform does not emit
// that sibling beside the worker, so the engine, the worker and the shared
// module are copied into public/vendor/maplibre by
// scripts/copy_maplibre_worker.mjs (npm run prepare:maplibre-worker), which
// runs before dev and before every build.
//
// The map documents modulepreload MAPLIBRE_GL_URL, the same URL the canvas
// imports, so the engine starts with the document instead of after the shell
// chunk has run. Its static import of the shared module is discovered once
// those bytes are parsed; naming that sibling in its own modulepreload was
// measured and slowed the first pin, because it competed with the engine on
// the same narrow pipe. The worker file is not named in the document: the
// canvas calls setWorkerUrl when it evaluates, and an earlier warm of that
// pair was measured and reverted (9b6dbcd8c, reverted by c52bb928b).
//
// Unit tests load the package (the donut suite mocks "maplibre-gl"). A server
// render of the map document only needs the URL, so it does not fetch the
// module.

type MapLibreNamespace = typeof import("maplibre-gl");

/** The worker module MapLibre is told to spawn. */
export const MAPLIBRE_WORKER_URL = "/vendor/maplibre/maplibre-gl-worker.mjs";

/** The engine module the map document modulepreloads. */
export const MAPLIBRE_GL_URL = "/vendor/maplibre/maplibre-gl.mjs";

export const maplibregl: MapLibreNamespace = await loadMapLibre();

async function loadMapLibre(): Promise<MapLibreNamespace> {
  if (process.env.NODE_ENV === "test") {
    return import("maplibre-gl");
  }
  if (typeof window === "undefined") {
    return null as unknown as MapLibreNamespace;
  }
  return import(
    /* turbopackIgnore: true */
    /* webpackIgnore: true */
    MAPLIBRE_GL_URL
  );
}
