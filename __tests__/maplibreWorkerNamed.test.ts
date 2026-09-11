import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MAPLIBRE_WORKER_SHARED_URL,
  MAPLIBRE_WORKER_URL,
} from "@/lib/maplibreWorkerAssets";

/**
 * THE ENGINE'S WORKER PAIR IS NAMED IN THE DOCUMENT, AND NOTHING FETCHES IT
 * EARLY.
 *
 * MapLibre 6's worker is a module that statically imports a sibling, and the
 * document named neither URL, so a cold `/map` discovered the 478 KB shared
 * module three hops late (perf/AGENTS.md, "THE ENGINE WAS NOT THE GATE").
 * Warming the pair was measured and REVERTED: it moved the module to 1,168 ms
 * requested but the first tappable pin did not move (14,565 ms against
 * 14,615 ms), and `__tests__/mapEarlyWarm.test.ts` forbids that script
 * fetching anything before `pubmax:first-pins`.
 *
 * So the document NAMES the pair and fetches neither. One module owns both
 * URLs, the map documents state them, and the canvas sets the worker URL from
 * the same constant, so a later A/B has one place to change and the reader
 * pays no byte for the naming.
 */

const ROOT = path.resolve(__dirname, "..");

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

const MAP_DOCUMENTS = ["app/map/page.tsx", "app/map/[city]/page.tsx"];

describe("the map documents name the worker pair", () => {
  it("states both URLs through the one module that owns them", () => {
    expect(MAPLIBRE_WORKER_URL).toBe("/vendor/maplibre/maplibre-gl-worker.mjs");
    expect(MAPLIBRE_WORKER_SHARED_URL).toBe("/vendor/maplibre/maplibre-gl-shared.mjs");
    for (const document of MAP_DOCUMENTS) {
      const source = read(document);
      expect(source).toContain("MAPLIBRE_WORKER_URL");
      expect(source).toContain("MAPLIBRE_WORKER_SHARED_URL");
      expect(source).toContain("@/lib/maplibreWorkerAssets");
    }
  });

  it("names them with a meta tag, never a link that fetches", () => {
    for (const document of MAP_DOCUMENTS) {
      const source = read(document);
      expect(source).toMatch(/<meta\s+name=\{MAPLIBRE_WORKER_META\}/);
      expect(source).not.toMatch(/rel="(preload|modulepreload|prefetch|preconnect)"/);
    }
  });

  it("keeps the canvas reading the same constant rather than a second string", () => {
    const canvas = read("components/PubMapCanvas.tsx");
    expect(canvas).toContain("maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL)");
    expect(canvas).toContain("@/lib/maplibreWorkerAssets");
  });

  it("adds no early fetch of either URL anywhere a document runs", () => {
    const sources = [
      ...MAP_DOCUMENTS,
      "public/map-first-paint-init.js",
      "components/PubMapCanvas.tsx",
      "components/PubMap.tsx",
    ].map((relative) => read(relative));
    for (const source of sources) {
      expect(source).not.toMatch(/fetch\([^)]*maplibre-gl-(worker|shared)\.mjs/);
      expect(source).not.toMatch(/rel=["']modulepreload["']/);
    }
  });
});
