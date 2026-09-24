import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getCity } from "@/lib/cities";

describe("cold /map opening camera", () => {
  const pubMap = readFileSync(join(process.cwd(), "components/PubMap.tsx"), "utf8");

  it("does not hold the opening camera at the world view while London resolves", () => {
    expect(pubMap).not.toContain("OPENING_LOCATION_HOLD_VIEW");
    expect(pubMap).not.toMatch(/center: \[0, 0\][\s\S]{0,80}zoom: 0/);
  });

  it("seeds list view from the list search param", () => {
    expect(pubMap).toContain("mapListOpenFromSearch(currentSearch())");
  });

  it("uses the city default view as the pre-location fallback", () => {
    const london = getCity("london").mapView;
    expect(pubMap).toContain("if (mapOpeningNeedsResolution) return { ...city.mapView };");
    expect(london.center[0]).toBeGreaterThan(-1);
    expect(london.center[0]).toBeLessThan(1);
    expect(london.zoom).toBeGreaterThan(10);
  });
});
