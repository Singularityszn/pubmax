import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sanitizeEvent } from "@/lib/analyticsEvents";

const MAP_READER_POSITION_FILES = [
  "lib/mapReaderPosition.ts",
  "lib/mapReaderPositionWatch.ts",
  "components/map/useMapReaderPosition.ts",
] as const;

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("map reader position stays on the device", () => {
  it.each(MAP_READER_POSITION_FILES)("%s never opens a network door", (file) => {
    const source = read(file);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bnavigator\.sendBeacon\s*\(/);
    expect(source).not.toMatch(/coarsenViewerPoint\s*\(/);
    expect(source).not.toMatch(/\/api\//);
    expect(source).not.toMatch(/analytics/i);
  });

  it("drops coordinate-shaped analytics props", () => {
    const event = sanitizeEvent("tonight_screen_view", {
      lat: 51.5,
      lng: -0.1,
    });
    expect(event).not.toBeNull();
    expect(JSON.stringify(event)).not.toMatch(/51\.5/);
  });

  it("the canvas reader-position write path only updates the GeoJSON source", () => {
    const source = read("components/PubMapCanvas.tsx");
    const start = source.indexOf("// The reader's dot is a CANVAS layer");
    const block = source.slice(start, source.indexOf("// Frame the crawl only when", start));
    expect(block).toContain('getSource("user-location")');
    expect(block).toContain("setData");
    expect(block).not.toMatch(/\b(flyTo|easeTo|jumpTo|fitBounds|setCenter)\s*\(/);
  });
});

describe("viewer coordinate egress", () => {
  it("map reader modules are not in the coarsening egress list because they never leave the browser", () => {
    const egress = read("__tests__/viewerCoordinateEgress.test.ts");
    for (const file of MAP_READER_POSITION_FILES) {
      expect(egress).not.toContain(`"${file}"`);
    }
  });
});
