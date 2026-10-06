import { describe, expect, it } from "vitest";

import { drinkLensEmptyVenueNote } from "@/lib/mapExperienceLens";
import { outListingsSectionTitle, outWindowNoun } from "@/lib/outListings";
import { historicCountLine } from "@/lib/pageFilters";

// Copy findings from the signed-out QA sweep (F28): lines that contradicted the
// screen around them and a range over nothing. The offline page's face and dash
// are measured in the browser (e2e/qa-sweep-css.spec.ts).

describe("the absence line beside a price nobody logged", () => {
  it("keeps the plain line when no other price is shown", () => {
    expect(drinkLensEmptyVenueNote("beer", "ready")).toBe("No beer price logged here yet.");
  });

  it("says no drinker has logged one when a listed price is on screen", () => {
    const note = drinkLensEmptyVenueNote("beer", "ready", true);
    expect(note).toBe("No beer price logged by a drinker here yet.");
    expect(note).not.toBe("No beer price logged here yet.");
  });

  it("leaves the unread and failed lines alone", () => {
    expect(drinkLensEmptyVenueNote("beer", "degraded", true)).toBe(
      drinkLensEmptyVenueNote("beer", "degraded"),
    );
    expect(drinkLensEmptyVenueNote("beer", "loading", true)).toBe(
      drinkLensEmptyVenueNote("beer", "loading"),
    );
  });
});

describe("the weekend window", () => {
  it("reads as a British sentence", () => {
    expect(outWindowNoun("weekend")).toBe("this weekend");
    expect(outListingsSectionTitle("weekend")).toBe("What's on this weekend");
  });
});

describe("the historic count line", () => {
  it("never prints a range over nothing", () => {
    const line = historicCountLine({ firstShown: 0, lastShown: 0, matchingPubs: 0, totalPubs: 342 });
    expect(line).toBe("0 of 342 pubs match");
    expect(line).not.toMatch(/0-0/);
  });

  it("keeps the two ranged lines", () => {
    expect(historicCountLine({ firstShown: 1, lastShown: 24, matchingPubs: 342, totalPubs: 342 })).toBe(
      "Showing 1-24 of 342 pubs",
    );
    expect(historicCountLine({ firstShown: 1, lastShown: 3, matchingPubs: 3, totalPubs: 342 })).toBe(
      "Showing 1-3 of 3 matches",
    );
  });
});
