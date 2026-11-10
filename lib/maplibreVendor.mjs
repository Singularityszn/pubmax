// The installed MapLibre version names the directory its worker modules are
// served from (public/vendor/maplibre/<version>/), so a MapLibre upgrade is a
// new URL and the files can be cached as immutable. Plain ESM because
// next.config.mjs and the build scripts read it; the browser reads the same
// version from NEXT_PUBLIC_MAPLIBRE_VERSION (lib/maplibreWorkerAssets.ts).
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** @type {string} */
export const MAPLIBRE_VERSION = require("maplibre-gl/package.json").version;
