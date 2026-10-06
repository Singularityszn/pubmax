import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import VenueDrinkPrices from "@/components/map/VenueDrinkPrices";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";

// The sheet said "No beer price logged here yet." directly above a listed beer
// price. With a figure nobody logged on screen, the line says no DRINKER has
// logged one, so it never denies the price beside it.

function render(priceShownFromAnotherLane?: boolean): string {
  return renderToStaticMarkup(
    createElement(VenueDrinkPrices, {
      venueId: "venue-1",
      venueName: "The Lamb",
      rows: [],
      activeLane: "beer",
      laneNoun: "beer",
      readStatus: "ready",
      priceShownFromAnotherLane,
      communityPrices: {} as CommunityPricesState,
      onLogPrice: () => {},
      canLog: false,
    }),
  );
}

describe("VenueDrinkPrices absence line", () => {
  it("says no drinker has logged one when another price is shown", () => {
    const html = render(true);
    expect(html).toContain("No beer price logged by a drinker here yet.");
    expect(html).not.toContain("No beer price logged here yet.");
  });

  it("keeps the plain line when no other price is shown", () => {
    expect(render()).toContain("No beer price logged here yet.");
    expect(render(false)).not.toContain("by a drinker");
  });
});
