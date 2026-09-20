import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sanitizeEvent } from "@/lib/analyticsEvents";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

// The modules themselves are swept by __tests__/viewerCoordinateEgress.test.ts,
// which owns the egress law and both of its lists. What is left here is the
// canvas WRITE path: the one place the reader's fix reaches MapLibre.
describe("map reader position reaches the canvas and nothing else", () => {
  it("the write path updates the GeoJSON source and never moves the camera", () => {
    // The probe module is where the write lives, so it is read for what it
    // does NOT do. Asserting it contains its own function's name would pass
    // whatever that function did.
    const probe = read("components/map/canvas/readerPositionProbe.ts");
    expect(probe).toMatch(/setData\s*\(/);
    expect(probe).not.toMatch(
      /\b(flyTo|easeTo|jumpTo|fitBounds|setCenter|setZoom|setBearing|setPitch)\s*\(/,
    );

    // And the canvas effect that owns the reader position calls that one
    // helper rather than reaching for the map itself.
    const canvas = read("components/PubMapCanvas.tsx");
    const start = canvas.indexOf("// The reader's dot is a CANVAS layer");
    expect(start).toBeGreaterThan(-1);
    const block = canvas.slice(
      start,
      canvas.indexOf("// Frame the crawl only when", start),
    );
    expect(block).toMatch(/syncReaderPositionOnMap\s*\(/);
    expect(block).not.toMatch(
      /\b(flyTo|easeTo|jumpTo|fitBounds|setCenter|setZoom|setBearing|setPitch)\s*\(/,
    );
  });

  it("drops coordinate-shaped analytics props", () => {
    const event = sanitizeEvent("tonight_screen_view", {
      lat: 51.5,
      lng: -0.1,
    });
    expect(event).not.toBeNull();
    expect(JSON.stringify(event)).not.toMatch(/51\.5/);
  });
});
