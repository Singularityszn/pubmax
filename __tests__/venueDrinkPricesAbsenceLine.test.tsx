import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import VenueDrinkPrices, { VenueDrinkAbsence } from "@/components/map/VenueDrinkPrices";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";

// The sheet said "No beer price logged here yet." directly above a listed beer
// price. With a figure nobody logged on screen, the block holds its line and
// the one under the price says no DRINKER has logged one, so it never denies
// the price beside it.

const LANE = {
  rows: [],
  activeLane: "beer",
  laneNoun: "beer",
  readStatus: "ready",
} as const;

function render(absenceBelowPrice?: boolean): string {
  return renderToStaticMarkup(
    createElement(VenueDrinkPrices, {
      ...LANE,
      venueId: "venue-1",
      venueName: "The Lamb",
      absenceBelowPrice,
      communityPrices: {} as CommunityPricesState,
      onLogPrice: () => {},
      canLog: false,
    }),
  );
}

describe("VenueDrinkPrices absence line", () => {
  it("says no drinker has logged one when another price is shown", () => {
    const html = renderToStaticMarkup(createElement(VenueDrinkAbsence, LANE));
    expect(html).toContain("No beer price logged by a drinker here yet.");
    expect(render(true)).not.toContain("price logged");
  });

  it("keeps the plain line when no other price is shown", () => {
    expect(render()).toContain("No beer price logged here yet.");
    expect(render(false)).not.toContain("by a drinker");
  });
});
