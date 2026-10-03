"use client";

import dynamic from "next/dynamic";

// The map documents are prerendered, and MapLibre is otherwise undiscoverable
// until the shell chunk has run and asked for the canvas. Rendered on the
// server, next/dynamic names this import's own content-hashed chunk in the
// document head as a script preload, so the engine's download starts with the
// document. It is the same /_next/static chunk the canvas imports: one copy,
// immutable-cached and held by the service worker, fetched through the
// bundler's own chunk loader like every other chunk.
//
// Nothing renders. The server never evaluates the engine, and in the browser
// the import settles to nothing either way, so a dropped connection here never
// reaches an error boundary; the canvas's own import and Retry still own that.
function Nothing() {
  return null;
}

const MapLibreEnginePreload = dynamic(
  () =>
    typeof window === "undefined"
      ? Promise.resolve(Nothing)
      : import("maplibre-gl").then(
          () => Nothing,
          () => Nothing,
        ),
  { loading: () => null },
);

export default MapLibreEnginePreload;
