import { describe, expect, it } from "vitest";

import { LIVE_BASEMAP_CREDITS } from "../e2e/helpers/mapNetworkFixtures";
import mapOpeningSnapshot from "@/lib/mapOpeningSnapshot.json";

// The browser suite's deterministic basemap (e2e/helpers/mapNetworkFixtures.ts)
// answers each provider's style URL with the credit that provider's live style
// ships, because MapLibre's own credit control prints whatever the loaded style
// credits and the layout pins measure that line (e2e/mobile-map-chrome-fit.spec.ts,
// "story and credit placement"). A fixture credit that drifted from the live one
// would pass those pins on a line no reader sees. The opening snapshot is the
// committed copy of the live OpenFreeMap credit: scripts/build_map_opening_snapshot.mjs
// reads it off the live style each time the snapshot is regenerated.

/** The credit as MapLibre's control prints it: tags dropped, entities read. */
function creditText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&copy;/g, "©")
    .replace(/\s+/g, " ")
    .trim();
}

describe("deterministic basemap credits", () => {
  it("credits OpenFreeMap with the line last read off its live style", () => {
    expect(creditText(LIVE_BASEMAP_CREDITS.openfreemap)).toBe(mapOpeningSnapshot.attribution);
  });

  it("credits CARTO and OpenStreetMap on the fallback, and never OpenFreeMap", () => {
    const carto = creditText(LIVE_BASEMAP_CREDITS.carto);
    expect(carto).toBe("© OpenStreetMap contributors © CARTO");
    expect(carto).not.toContain("OpenFreeMap");
    expect(carto).not.toContain("OpenMapTiles");
  });
});
