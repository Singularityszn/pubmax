import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { MAPLIBRE_VERSION } from "../../lib/maplibreVendor.mjs";

const require = createRequire(import.meta.url);
const WORKER_MODULES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

/**
 * Write the installed worker modules to <vendorDir>/<version> and remove other
 * versions. Idempotent. A file is replaced by rename, so a second process or a
 * server reading it never sees half a file.
 */
export function writeMapLibreWorkerModules(vendorDir) {
  const sourceDir = join(dirname(require.resolve("maplibre-gl/package.json")), "dist");
  const targetDir = join(vendorDir, MAPLIBRE_VERSION);
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(vendorDir)) {
    if (entry !== MAPLIBRE_VERSION) rmSync(join(vendorDir, entry), { recursive: true, force: true });
  }
  for (const file of WORKER_MODULES) {
    const bytes = readFileSync(join(sourceDir, file));
    const target = join(targetDir, file);
    if (existsSync(target) && readFileSync(target).equals(bytes)) continue;
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, bytes);
    renameSync(temporary, target);
  }
  return targetDir;
}
