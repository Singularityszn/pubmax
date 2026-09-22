import { describe, expect, it } from "vitest";
import {
  outingAsk,
  outingShortlist,
  parseOutingOccasion,
} from "@/lib/outingOccasions";
import type { ConciergeVenue } from "@/lib/concierge/rank";
const venue = (
  id: string,
  amenities: Partial<ConciergeVenue["amenities"]> = {},
): ConciergeVenue => ({
  id,
  name: id,
  area: "Camden",
  lat: 51.54,
  lng: -0.14,
  cheapestPrice: null,
  amenities: {
    food: false,
    cocktails: false,
    beerGarden: false,
    liveMusic: false,
    liveSports: false,
    ...amenities,
  },
  nearWater: false,
  hasStory: false,
  canonical: true,
});
describe("outing shortlists", () => {
  it("defaults invalid occasions to date", () =>
    expect(parseOutingOccasion("unknown")).toBe("date"));
  it("does not infer a garden from missing evidence", () => {
    expect(
      outingShortlist(
        [venue("unknown"), venue("garden", { beerGarden: true })],
        "gardens",
        "Camden",
      ).map((x) => x.venue.id),
    ).toEqual(["garden"]);
  });
  it("keeps the chosen area and refuses unrelated replacements", () => {
    expect(
      outingShortlist([venue("food", { food: true })], "date", "Soho"),
    ).toEqual([]);
    expect(outingAsk("date", "Soho")).toContain("in Soho");
  });
  it("requires a positive factual basis for editorial quiet estimates", () => {
    expect(
      outingShortlist(
        [venue("unknown"), venue("food", { food: true })],
        "quiet",
        "Camden",
      ).map((x) => x.venue.id),
    ).toEqual(["food"]);
  });
});
