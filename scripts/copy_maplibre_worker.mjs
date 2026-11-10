import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MAPLIBRE_VERSION } from "../lib/maplibreVendor.mjs";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDir = join(projectRoot, "node_modules", "maplibre-gl", "dist");
const vendorDir = join(projectRoot, "public", "vendor", "maplibre");
const targetDir = join(vendorDir, MAPLIBRE_VERSION);
const workerFiles = [
  "maplibre-gl-worker.mjs",
  "maplibre-gl-shared.mjs",
];

// One version directory at a time, so an upgrade never ships the old worker.
await rm(vendorDir, { recursive: true, force: true });
await mkdir(targetDir, { recursive: true });
await Promise.all(
  workerFiles.map((file) => copyFile(join(sourceDir, file), join(targetDir, file))),
);

console.log(`Copied MapLibre ${MAPLIBRE_VERSION} worker modules to ${targetDir}`);
