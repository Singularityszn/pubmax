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

  it("requires both live-noise flags to be explicitly known quiet", () => {
    const unknownNoise = venue("unknown-noise", { food: true });
    Reflect.deleteProperty(unknownNoise.amenities, "liveMusic");
    Reflect.deleteProperty(unknownNoise.amenities, "liveSports");

    expect(outingShortlist([unknownNoise], "quiet", "Camden")).toEqual([]);
  });

  it("excludes a venue with a known loud listing on the selected date", () => {
    const quiet = venue("quiet", { food: true });
    const noisy = venue("noisy", { food: true });
    const listings = [{
      id: "same-night-gig",
      venueId: "noisy",
      placeName: noisy.name,
      kind: "music" as const,
      title: "Live band",
      startsAt: "2026-09-22T20:00:00.000Z",
      source: { label: "Venue programme", url: "https://example.com/music" },
      observedAt: "2026-09-22T12:00:00.000Z",
      confidence: "listed" as const,
    }];

    expect(
      outingShortlist([quiet, noisy], "quiet", "Camden", {
        date: "2026-09-22",
        events: listings,
      }).map((x) => x.venue.id),
    ).toEqual(["quiet"]);
  });

  it("filters alcohol-free browse to venues with positive recorded offer evidence", () => {
    const listed = venue("listed", { nonAlcoholic: true });
    const absent = venue("absent", { nonAlcoholic: false });
    const unknown = venue("unknown", { nonAlcoholic: false });
    Reflect.deleteProperty(unknown.amenities, "nonAlcoholic");

    expect(
      outingShortlist([listed, absent, unknown], "friends", "Camden", { alcohol: "none" })
        .map((row) => row.venue.id),
    ).toEqual(["listed"]);
  });
});
