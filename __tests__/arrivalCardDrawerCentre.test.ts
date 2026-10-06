import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// At 1440 an open venue drawer cut the right half of the "Cheapest pints near
// you?" ask. It now centres on the map lane the drawer leaves, like the banners.
describe("map arrival card beside a desktop drawer", () => {
  const css = readFileSync(join(process.cwd(), "components/map/mapBannerStaging.css"), "utf8");

  it("centres on the lane left of the venue drawer", () => {
    expect(css).toMatch(
      /body:has\(\.appShell\.detail-open\) \.mapArrivalCard \{[^}]*left: calc\(\(100% - var\(--desktop-venue-drawer-width\)\) \/ 2\)[^}]*width: min\(680px, calc\(100% - var\(--desktop-venue-drawer-width\) - 32px\)\)/,
    );
  });

  it("centres on the lane right of the planner rail", () => {
    expect(css).toMatch(/body:has\(\.appShell\.planning-open\) \.mapArrivalCard/);
  });
});
