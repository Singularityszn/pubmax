import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MAPLIBRE_VERSION } from "../lib/maplibreVendor.mjs";
import { writeMapLibreWorkerModules } from "./lib/maplibreWorkerModules.mjs";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const targetDir = writeMapLibreWorkerModules(join(projectRoot, "public", "vendor", "maplibre"));

console.log(`Copied MapLibre ${MAPLIBRE_VERSION} worker modules to ${targetDir}`);
