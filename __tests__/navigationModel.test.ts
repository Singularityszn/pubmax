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

  it("keeps capture separate from the map and sends Stories to the social feed", () => {
    expect(PRIMARY_NAV_ITEMS.map(({ href }) => href)).toEqual([
      "/map",
      "/tonight",
      "/moment",
      "/feed",
      "/u/you",
    ]);
  });
});
