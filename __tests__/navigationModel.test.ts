import { describe, expect, it } from "vitest";

import { PRIMARY_NAV_ITEMS } from "@/components/nav/navigationModel";

describe("PUBMAXX primary navigation", () => {
  it("keeps the same five user jobs in the same order across viewports", () => {
    expect(PRIMARY_NAV_ITEMS.map(({ label }) => label)).toEqual([
      "Map",
      "Tonight",
      "Moment",
      "Stories",
      "You",
    ]);
  });

  it("preserves the existing product routes", () => {
    expect(PRIMARY_NAV_ITEMS.map(({ href }) => href)).toEqual([
      "/map",
      "/tonight",
      "/map?log=1",
      "/discover",
      "/u/you",
    ]);
  });
});
