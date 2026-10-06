import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MAPLIBRE_WORKER_URL } from "@/lib/maplibreWorkerAssets";

// Perf lane: MapLibre must not ride the PubMap shell's first-load chunk.
// These are source locks so a silent re-static-import fails CI.

const pubMap = readFileSync(join(process.cwd(), "components/PubMap.tsx"), "utf8");
const canvas = readFileSync(join(process.cwd(), "components/PubMapCanvas.tsx"), "utf8");
const globalsCss = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
const workerCopy = readFileSync(
  join(process.cwd(), "scripts/copy_maplibre_worker.mjs"),
  "utf8",
);

describe("maplibre cold-open code split", () => {
  it("loads PubMapCanvas via next/dynamic (ssr:false), not a static value import", () => {
    // The loader is behind a factory because React caches a REJECTED lazy for
    // ever: a retry after a blocked chunk has to build a fresh one or it
    // replays the rejection without touching the network
    // (lib/mapCanvasAvailability.ts). The import stays dynamic either way,
    // which is the whole of what keeps MapLibre out of this shell chunk.
    expect(pubMap).toMatch(
      /function loadPubMapCanvas\(\) \{\s*\n?\s*return dynamic\(\(\) => import\(["']@\/components\/PubMapCanvas["']\)/,
    );
    expect(pubMap).toMatch(/pubMapCanvasForAttempt/);
    expect(pubMap).toMatch(/ssr:\s*false/);
    // No static default import of the canvas module.
    expect(pubMap).not.toMatch(/^import PubMapCanvas from/m);
    expect(pubMap).not.toMatch(/import PubMapCanvas,/);
  });

  it("keeps a full-bleed map-shaped skeleton so CLS stays 0 during the split", () => {
    expect(pubMap).toMatch(/mapCanvasSkeleton/);
    expect(globalsCss).toMatch(/\.mapCanvasSkeleton\s*\{/);
    expect(globalsCss).toMatch(/background:\s*var\(--ink-deep/);
  });

  it("defers tfl_lines transit GeoJSON past the first assembleScene", () => {
    // First scene assembly must not pass the live transit path (MapLibre would
    // fetch /data/tfl_lines.json on the critical path).
    expect(canvas).toMatch(/transitLinesPath:\s*null/);
    expect(canvas).toMatch(/buildTransitLines/);
    expect(canvas).toMatch(/map\.once\(\s*["']idle["']/);
    // Fallback when continuous tile paint starves `idle`.
    expect(canvas).toMatch(/setTimeout\(loadDeferredTransit,\s*2500\)/);
  });

  it("keeps value maplibre-gl imports only inside the canvas chunk modules", () => {
    // PubMap shell must not import maplibre-gl by value.
    expect(pubMap).not.toMatch(/from ["']maplibre-gl["']/);
    // Canvas + its helpers remain the only value importers (locked locations).
    const donut = readFileSync(
      join(process.cwd(), "components/map/canvas/donutClusters.ts"),
      "utf8",
    );
    const camera = readFileSync(
      join(process.cwd(), "components/map/canvas/useMapCamera.ts"),
      "utf8",
    );
    expect(canvas).toMatch(/import \* as maplibregl from ["']maplibre-gl["']/);
    expect(donut).toMatch(/from ["']maplibre-gl["']/);
    expect(camera).toMatch(/from ["']maplibre-gl["']/);
  });

  it("configures the MapLibre 6 module worker for webpack", () => {
    expect(MAPLIBRE_WORKER_URL).toBe("/vendor/maplibre/maplibre-gl-worker.mjs");
    // ignore-scripts skips predev/prebuild, so both steps live in the commands
    // npm actually runs. The fresh check stays ahead of next dev.
    expect(packageJson.scripts.dev).toBe(
      "node scripts/check_node_modules_fresh.mjs && npm run prepare:maplibre-worker && npm run build:places-enrichment && next dev --webpack",
    );
    expect(packageJson.scripts.build).toMatch(/^npm run prepare:maplibre-worker && /);
    expect(workerCopy).toContain('"maplibre-gl-worker.mjs"');
    expect(workerCopy).toContain('"maplibre-gl-shared.mjs"');
  });

  it("uses the MapLibre 6 missing-image resolver", () => {
    expect(canvas).toMatch(/map\.setMissingStyleImageResolver\(/);
    expect(canvas).not.toMatch(/map\.on\(["']styleimagemissing["']/);
  });
});
